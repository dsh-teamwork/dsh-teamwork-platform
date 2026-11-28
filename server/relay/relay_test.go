package relay

// The relay's tests, ported from the Node relay's four suites (pairing, the
// plugin's socket, forwarding, push), run against the real server on each
// database the open suites reach (server/edition/editiontest).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relayhost"
)

type obj = map[string]any

// A relay credential is independent of the E2EE private key; only the matching handset may route a pairing.
type handset struct{ token, key string }

var keyA = strings.Repeat("A", 43)
var keyB = strings.Repeat("B", 43)

// world is one server with the relay mounted, and two members of a team.
type world struct {
	t                  *testing.T
	in                 *editiontest.Instance
	r                  *relay
	ada, bob           string // tokens
	adaPhone, bobPhone handset
	adaID              string
	outsider           string // a signed-in person in no team
	mu                 sync.Mutex
	pushed             [][]edition.PushMessage
}

func each(t *testing.T, f func(t *testing.T, w *world)) { eachWith(t, true, f) }

// eachWith is each on a server that delivers notifications, recorded in
// w.pushed, or, without push, on one that delivers none, as a self-hosted
// server does.
func eachWith(t *testing.T, push bool, f func(t *testing.T, w *world)) {
	var w *world
	ext := edition.Extension{
		Name: "open-relay",
		Mount: func(h edition.Host) (func(), error) {
			if push {
				if err := h.SetPush(func(_ context.Context, m []edition.PushMessage) error {
					w.mu.Lock()
					w.pushed = append(w.pushed, m)
					w.mu.Unlock()
					return nil
				}); err != nil {
					return nil, err
				}
			}
			w.r = newRelay(h, 200*time.Millisecond)
			if err := h.SubscribeTeams(w.r.accountDeleted); err != nil {
				return nil, err
			}
			w.r.routes(h.Mux)
			return w.r.close, nil
		},
	}
	// Mount runs inside Each, before f: w must exist first.
	w = &world{}
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		w.t, w.in, w.pushed = t, in, nil
		w.adaID = in.Account("ada@example.test")
		bobID := in.Account("bob@example.test")
		in.Team(w.adaID)
		in.Team(bobID)
		w.ada, w.bob = in.Bearer(w.adaID), in.Bearer(bobID)
		w.adaPhone, w.bobPhone = handset{w.ada, keyA}, handset{w.bob, keyB}
		w.outsider = in.Bearer(in.Account("eve@example.test"))
		f(t, w)
	})
}

// peer is an open socket that records every frame it receives, and waits for
// the one a test expects.
type peer struct {
	t       *testing.T
	c       *websocket.Conn
	mu      sync.Mutex
	frames  []obj
	welcome obj
	code    websocket.StatusCode // the close code, when the relay closed it before a welcome
	ended   websocket.StatusCode // the close code, whenever it came
	closed  chan struct{}
}

func (w *world) open(path string, hello obj) *peer {
	w.t.Helper()
	return w.openWith(path, nil, hello)
}

// openWith opens a socket whose upgrade carries header, as a browser's
// carries its Origin and cookies.
func (w *world) openWith(path string, header http.Header, hello obj) *peer {
	w.t.Helper()
	url := strings.Replace(w.in.URL, "http", "ws", 1) + path
	c, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		w.t.Fatal(err)
	}
	c.SetReadLimit(maxFrameBytes * 2)
	p := &peer{t: w.t, c: c, closed: make(chan struct{}), code: -1}
	welcomed := make(chan struct{})
	go func() {
		defer close(p.closed)
		for {
			kind, data, err := c.Read(context.Background())
			if err != nil {
				p.mu.Lock()
				p.ended = websocket.CloseStatus(err)
				if p.welcome == nil {
					p.code = websocket.CloseStatus(err)
				}
				p.mu.Unlock()
				return
			}
			var f obj
			if kind == websocket.MessageBinary {
				f = unsealed(data)
			} else {
				json.Unmarshal(data, &f)
			}
			p.mu.Lock()
			if p.welcome == nil && f["t"] == "welcome" {
				p.welcome = f
				close(welcomed)
			} else {
				p.frames = append(p.frames, f)
			}
			p.mu.Unlock()
		}
	}()
	p.send(hello)
	select {
	case <-welcomed:
	case <-p.closed:
	case <-time.After(5 * time.Second):
		w.t.Fatal("no welcome and no close")
	}
	w.t.Cleanup(func() { c.CloseNow() })
	return p
}

func (w *world) host(token, clientID string) *peer {
	w.t.Helper()
	return w.open("/relay/plugin", obj{"t": "hello", "token": token, "clientId": clientID, "name": "laptop", "dshVersion": "0.2.2-rc.1", "pluginVersion": "0.18.0", "os": "macos"})
}

func (w *world) phone(h handset) *peer {
	w.t.Helper()
	return w.open("/relay/phone", obj{"t": "hello", "token": h.token, "deviceKey": h.key})
}

// send writes v as JSON, or, for a `sealed` frame, as the binary record the
// clients send (sealedFrame).
func (p *peer) send(v any) {
	kind, b := websocket.MessageText, []byte(nil)
	if f, ok := v.(obj); ok && f["t"] == "sealed" && f["data"] != nil {
		kind, b = websocket.MessageBinary, sealedFrame(f)
	} else {
		b, _ = json.Marshal(v)
	}
	if err := p.c.Write(context.Background(), kind, b); err != nil {
		p.t.Fatal(err)
	}
}

var kindNames = []string{"", "commit", "reveal", "noise", "data"}

// sealedFrame is the binary record for a sealed obj, its data written as bytes.
func sealedFrame(f obj) []byte {
	id, channel, data := f["pairingId"].(string), f["channelId"].(string), f["data"].(string)
	kind := byte(0)
	for i, name := range kindNames {
		if name == f["kind"] {
			kind = byte(i)
		}
	}
	return append(append(append([]byte{kind, byte(len(id))}, id...), channel...), data...)
}

// unsealed reads a binary record back into the obj a test compares.
func unsealed(b []byte) obj {
	n := int(b[1])
	return obj{"t": "sealed", "kind": kindNames[b[0]], "pairingId": string(b[2 : 2+n]), "channelId": string(b[2+n : 2+n+22]), "data": string(b[2+n+22:])}
}

func (p *peer) next(match func(obj) bool) obj {
	p.t.Helper()
	for range 200 {
		p.mu.Lock()
		for i, f := range p.frames {
			if match(f) {
				p.frames = append(p.frames[:i], p.frames[i+1:]...)
				p.mu.Unlock()
				return f
			}
		}
		p.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.t.Fatalf("no matching frame; had %v", p.frames)
	return nil
}

func (p *peer) none(match func(obj) bool) {
	p.t.Helper()
	time.Sleep(50 * time.Millisecond)
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, f := range p.frames {
		if match(f) {
			p.t.Fatalf("unexpected frame %v", f)
		}
	}
}

func is(t string) func(obj) bool { return func(f obj) bool { return f["t"] == t } }

func (p *peer) hostID() string { return p.welcome["hostId"].(string) }

// ask sends a plugin request and returns its reply.
func (p *peer) ask(req obj) obj {
	p.t.Helper()
	id := fmt.Sprint(time.Now().UnixNano())
	req["id"] = id
	p.send(req)
	return p.next(func(f obj) bool { return f["t"] == "reply" && f["id"] == id })
}

// paired puts a pairing straight in the table: confirmed unless told otherwise.
func (w *world) paired(userID, hostID string, confirmed bool) string {
	w.t.Helper()
	c := w.r.db.RelayPairing.Create().SetUserID(userID).SetHostID(hostID).SetDeviceName("phone").SetDeviceKeyHash(w.r.pairings.deviceHash(keyA))
	if confirmed {
		c.SetConfirmedAt(time.Now())
	}
	p, err := c.Save(context.Background())
	if err != nil {
		w.t.Fatal(err)
	}
	return p.ID
}

// call is an HTTP request from a phone, with its account Bearer and handset credential.
func (w *world) call(h handset, method, path string, body any) (int, obj) {
	w.t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, w.in.URL+path, r)
	req.Header.Set("Authorization", "Bearer "+h.token)
	if h.key != "" {
		req.Header.Set("X-Device-Key", h.key)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		w.t.Fatal(err)
	}
	defer res.Body.Close()
	var out obj
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func equal(t *testing.T, got, want any) {
	t.Helper()
	g, _ := json.Marshal(got)
	var gv, wv any
	json.Unmarshal(g, &gv)
	wb, _ := json.Marshal(want)
	json.Unmarshal(wb, &wv)
	if !reflect.DeepEqual(gv, wv) {
		t.Fatalf("got %s, want %s", g, wb)
	}
}

// --- the plugin's socket ---

func TestPluginSocket(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		// A team member is welcomed, and the computer recorded as a host.
		p := w.host(w.ada, "client-one")
		host, err := w.r.db.RelayHost.Get(context.Background(), p.hostID())
		if err != nil || host.ClientID != "client-one" || host.DshVersion != "0.2.2-rc.1" || host.UserID != w.adaID ||
			host.Os == nil || *host.Os != relayhost.OsMacos {
			t.Fatalf("host %+v %v", host, err)
		}
		w.r.mu.Lock()
		_, live := w.r.hosts[host.ID]
		w.r.mu.Unlock()
		if !live {
			t.Fatal("the host is not connected")
		}

		// A person in no team, and a token that is not one.
		if code := w.host(w.outsider, "client-two").code; code != closeUnauthorized {
			t.Fatalf("outsider: %d", code)
		}
		if code := w.host("forged", "client-two").code; code != closeUnauthorized {
			t.Fatalf("forged: %d", code)
		}
		// A first frame that is not a hello.
		if code := w.open("/relay/plugin", obj{"t": "call", "method": "session/list"}).code; code != closeBadHello {
			t.Fatalf("not a hello: %d", code)
		}
		if code := w.host(w.ada, "bad id!").code; code != closeBadHello {
			t.Fatalf("bad client id: %d", code)
		}
		// An operating system the relay does not name is refused; a plugin too old to report one is not.
		hello := obj{"t": "hello", "token": w.ada, "clientId": "client-three", "name": "box", "dshVersion": "0.2.2-rc.1", "os": "darwin"}
		if code := w.open("/relay/plugin", hello).code; code != closeBadHello {
			t.Fatalf("unknown os: %d", code)
		}
		delete(hello, "os")
		// A plugin version, when sent, is not empty.
		hello["pluginVersion"] = "  "
		if code := w.open("/relay/plugin", hello).code; code != closeBadHello {
			t.Fatalf("empty plugin version: %d", code)
		}
		delete(hello, "pluginVersion")
		old := w.open("/relay/plugin", hello)
		if h := w.r.db.RelayHost.GetX(context.Background(), old.hostID()); h.Os != nil || h.PluginVersion != nil {
			t.Fatalf("an old plugin's os %v, plugin version %v", h.Os, h.PluginVersion)
		}
		// No hello at all: 4400 when the time is up, not a dropped connection.
		helloTimeout = 300 * time.Millisecond
		defer func() { helloTimeout = 5 * time.Second }()
		silent, _, err := websocket.Dial(context.Background(), strings.Replace(w.in.URL, "http", "ws", 1)+"/relay/plugin", nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := silent.Read(context.Background()); websocket.CloseStatus(err) != closeBadHello {
			t.Fatalf("no hello: %v", err)
		}

		// A member who leaves every team loses an open socket at the next ping.
		gone := w.in.Account("gone@example.test")
		w.in.Team(gone)
		leaving := w.host(w.in.Bearer(gone), "leaving-client")
		if leaving.welcome == nil {
			t.Fatal("not welcomed")
		}
		if _, err := w.in.SQL.ExecContext(context.Background(), "DELETE FROM memberships WHERE user_id = '"+gone+"'"); err != nil {
			t.Fatal(err)
		}
		select {
		case <-leaving.closed:
		case <-time.After(3 * time.Second):
			t.Fatal("the socket outlived the membership")
		}
		if leaving.ended != closeUnauthorized {
			t.Fatalf("left: %d", leaving.ended)
		}

		// One host per computer: a second connection replaces the first.
		first := w.host(w.ada, "twice-xx")
		second := w.host(w.ada, "twice-xx")
		if second.hostID() != first.hostID() {
			t.Fatal("a second host for one computer")
		}
		select {
		case <-first.closed:
		case <-time.After(2 * time.Second):
			t.Fatal("the first socket stayed open")
		}
		if first.ended != closeReplaced {
			t.Fatalf("replaced: %d", first.ended)
		}
	})
}

// --- pairing ---

func TestPairing(t *testing.T) {
	codePattern := regexp.MustCompile(`^[A-Z]{6}$`)
	each(t, func(t *testing.T, w *world) {
		host := w.host(w.ada, "ada-laptop")
		offer := host.ask(obj{"t": "offer"})["value"].(obj)
		if !codePattern.MatchString(offer["code"].(string)) {
			t.Fatalf("code %v", offer["code"])
		}

		// The phone redeems the code; the pairing starts pending and the computer hears of it.
		status, body := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": strings.ToLower(offer["code"].(string)), "deviceName": "Ada’s iPhone"})
		if status != 201 {
			t.Fatalf("redeem: %d %v", status, body)
		}
		pairing := body["pairing"].(obj)
		if pairing["hostId"] != host.hostID() || pairing["deviceName"] != "Ada’s iPhone" || pairing["status"] != "pending" {
			t.Fatalf("pairing %v", pairing)
		}
		id := pairing["id"].(string)
		if heard := host.next(is("paired")); heard["pairing"].(obj)["id"] != id {
			t.Fatalf("paired %v", heard)
		}

		// Confirmed on the computer, from the host it belongs to.
		equal(t, host.ask(obj{"t": "decide", "pairingId": id, "accept": true})["value"], nil)
		_, listed := w.call(w.adaPhone, "GET", "/relay/pairings", nil)
		got := listed["pairings"].([]any)[0].(obj)
		if got["id"] != id || got["status"] != "confirmed" || got["online"] != true || got["hostName"] != "laptop" || got["hostOs"] != "macos" {
			t.Fatalf("listed %v", got)
		}
		// When the computer was last seen is its host's own record, for the phone to say how long it has been away.
		if seen := w.r.db.RelayHost.GetX(context.Background(), host.hostID()).LastSeenAt; got["hostLastSeenAt"] != iso(seen) {
			t.Fatalf("host last seen %v, want %s", got["hostLastSeenAt"], iso(seen))
		}
		if list := host.ask(obj{"t": "pairings"})["value"].([]any); len(list) != 1 || list[0].(obj)["status"] != "confirmed" {
			t.Fatalf("host's list %v", list)
		}

		// Revoked from the phone: gone from both lists, and the computer is told.
		if status, _ := w.call(w.adaPhone, "DELETE", "/relay/pairings/"+id, nil); status != 204 {
			t.Fatalf("revoke: %d", status)
		}
		equal(t, host.next(is("revoked")), obj{"t": "revoked", "pairingId": id})
		_, listed = w.call(w.adaPhone, "GET", "/relay/pairings", nil)
		equal(t, listed["pairings"], []any{})
		equal(t, host.ask(obj{"t": "pairings"})["value"], []any{})

		// A code is spent once, and a later offer replaces an unused one.
		first := host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		second := host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		pair := func(h handset, code any) (int, obj) {
			return w.call(h, "POST", "/relay/pair", obj{"code": code, "deviceName": "Pixel"})
		}
		if _, b := pair(w.adaPhone, first); b["error"] != "invalid_code" {
			t.Fatalf("a replaced code: %v", b)
		}
		if s, _ := pair(w.adaPhone, second); s != 201 {
			t.Fatalf("second: %d", s)
		}
		if _, b := pair(w.adaPhone, second); b["error"] != "invalid_code" {
			t.Fatalf("a spent code: %v", b)
		}

		// Another member's phone, a stranger, and someone else's computer.
		bobs := w.host(w.bob, "bob-laptop")
		code := host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		if _, b := pair(w.bobPhone, code); b["error"] != "invalid_code" {
			t.Fatalf("bob redeemed ada's code: %v", b)
		}
		if s, _ := w.call(handset{"forged", keyA}, "GET", "/relay/pairings", nil); s != 401 {
			t.Fatalf("stranger: %d", s)
		}
		if s, _ := w.call(handset{w.outsider, keyA}, "GET", "/relay/pairings", nil); s != 401 {
			t.Fatalf("outsider: %d", s)
		}
		_, b := pair(w.adaPhone, code)
		pid := b["pairing"].(obj)["id"].(string)
		if r := bobs.ask(obj{"t": "decide", "pairingId": pid, "accept": true}); r["error"] != "not_found" {
			t.Fatalf("bob decided: %v", r)
		}
		if r := bobs.ask(obj{"t": "revoke", "pairingId": pid}); r["error"] != "not_found" {
			t.Fatalf("bob revoked: %v", r)
		}
		if s, _ := w.call(w.bobPhone, "DELETE", "/relay/pairings/"+pid, nil); s != 404 {
			t.Fatalf("bob's phone revoked: %d", s)
		}
		// Refused on Ada's computer: the pairing ends.
		equal(t, host.ask(obj{"t": "decide", "pairingId": pid, "accept": false})["value"], nil)
		_, listed = w.call(w.adaPhone, "GET", "/relay/pairings", nil)
		for _, p := range listed["pairings"].([]any) {
			if p.(obj)["id"] == pid {
				t.Fatal("a refused pairing is still listed")
			}
		}

		// An expired code.
		old, err := w.r.pairings.offer(context.Background(), host.hostID(), time.Now().Add(-3*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if _, b := pair(w.adaPhone, old.Code); b["error"] != "invalid_code" {
			t.Fatalf("expired: %v", b)
		}

		// Bad input.
		if s, _ := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": "AB", "deviceName": "p"}); s != 400 {
			t.Fatalf("short code: %d", s)
		}
	})
}

// --- forwarding ---

func sealed(id, data string) obj {
	return obj{"t": "sealed", "pairingId": id, "channelId": "abcdefghijklmnopqrstuv", "kind": "noise", "data": data}
}

func TestForwarding(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		laptop := w.host(w.ada, "fwd-client")
		id := w.paired(w.adaID, laptop.hostID(), true)
		phone := w.phone(w.adaPhone)
		message := sealed(id, "opaque-ciphertext")
		for _, kind := range []string{"commit", "reveal", "noise", "data"} {
			message["kind"] = kind
			phone.send(message)
			equal(t, laptop.next(is("sealed")), message)
		}
		laptop.send(sealed(id, "encrypted-reply"))
		equal(t, phone.next(is("sealed")), sealed(id, "encrypted-reply"))
		if p, _ := w.r.db.RelayPairing.Get(context.Background(), id); p.LastUsedAt == nil {
			t.Fatal("use not recorded")
		}

		// Plaintext business frames are never forwarded, even for a confirmed pairing, and a
		// sealed record only goes as binary.
		for _, kind := range []string{"call", "mux"} {
			phone.send(obj{"t": kind, "pairingId": id, "id": "x", "method": "session/list", "body": obj{}})
		}
		text, _ := json.Marshal(sealed(id, "as-text"))
		phone.c.Write(context.Background(), websocket.MessageText, text)
		laptop.none(func(f obj) bool { return f["data"] == "as-text" })
		for _, bad := range [][]byte{{9, 1, 'p'}, append([]byte{4, 0}, "abcdefghijklmnopqrstuvx"...), append([]byte{4, 1, 'p'}, "short"...)} {
			phone.c.Write(context.Background(), websocket.MessageBinary, bad)
		}
		laptop.none(is("sealed"))
		laptop.none(is("call"))
		laptop.none(is("mux"))
		laptop.send(obj{"t": "result", "pairingId": id, "id": "x", "status": 200, "body": "plaintext"})
		phone.none(is("result"))
		// Pending devices may exchange encryption records. Only local desktop verification admits business traffic.
		pending := w.paired(w.adaID, laptop.hostID(), false)
		phone.send(sealed(pending, "pending-handshake"))
		equal(t, laptop.next(is("sealed")), sealed(pending, "pending-handshake"))
		otherUser := w.paired("someone-else", laptop.hostID(), true)
		for _, bad := range []string{otherUser, "absent"} {
			phone.send(sealed(bad, "ciphertext"))
			equal(t, phone.next(is("error")), obj{"t": "error", "pairingId": bad, "error": "not_paired"})
		}
		if code := w.phone(handset{"forged", keyA}).code; code != closeUnauthorized {
			t.Fatalf("forged phone: %d", code)
		}
		if code := w.open("/relay/phone", obj{"t": "sealed"}).code; code != closeBadHello {
			t.Fatalf("bad hello: %d", code)
		}

		other := w.host(w.ada, "other-client")
		other.send(sealed(id, "forged-answer"))
		laptop.send(sealed(id, "real-answer"))
		equal(t, phone.next(is("sealed"))["data"], "real-answer")
		phone.none(is("sealed"))

		fromPhone, fromHost := w.paired(w.adaID, laptop.hostID(), true), w.paired(w.adaID, laptop.hostID(), true)
		for _, pair := range []string{fromPhone, fromHost} {
			phone.send(sealed(pair, "open"))
			laptop.next(is("sealed"))
		}
		if status, _ := w.call(w.adaPhone, "DELETE", "/relay/pairings/"+fromPhone, nil); status != 204 {
			t.Fatalf("delete %d", status)
		}
		equal(t, phone.next(is("revoked")), obj{"t": "revoked", "pairingId": fromPhone})
		laptop.next(is("revoked"))
		laptop.send(obj{"t": "revoke", "id": "r", "pairingId": fromHost})
		phone.next(is("revoked"))
		phone.send(sealed(fromPhone, "late"))
		equal(t, phone.next(is("error"))["error"], "not_paired")
		laptop.send(sealed(fromHost, "late"))
		phone.none(is("sealed"))

		away := w.host(w.ada, "away-client")
		awayID := w.paired(w.adaID, away.hostID(), true)
		phone.send(sealed(awayID, "open"))
		away.next(is("sealed"))
		away.c.Close(websocket.StatusNormalClosure, "")
		equal(t, phone.next(is("offline")), obj{"t": "offline", "pairingId": awayID})
		phone.send(sealed(awayID, "later"))
		equal(t, phone.next(is("error"))["error"], "offline")

		second := w.phone(w.adaPhone)
		second.send(sealed(id, "takeover"))
		equal(t, phone.next(is("detached")), obj{"t": "detached", "pairingId": id})
		laptop.next(is("detach"))
		laptop.next(is("sealed"))
		laptop.send(sealed(id, "answer"))
		equal(t, second.next(is("sealed"))["data"], "answer")
		phone.none(is("sealed"))
		rate := w.paired(w.adaID, laptop.hostID(), true)
		for i := 0; i <= rateLimit; i++ {
			second.send(sealed(rate, "opaque"))
		}
		equal(t, second.next(is("error")), obj{"t": "error", "pairingId": rate, "error": "rate_limited"})
		time.Sleep(100 * time.Millisecond)
		laptop.mu.Lock()
		count := 0
		for _, f := range laptop.frames {
			if f["t"] == "sealed" && f["pairingId"] == rate {
				count++
			}
		}
		laptop.mu.Unlock()
		if count != rateLimit {
			t.Fatalf("passed %d frames", count)
		}
		second.c.Close(websocket.StatusNormalClosure, "")
		laptop.next(is("detach"))
	})
}

// --- push ---

func TestPush(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		laptop := w.host(w.ada, "push-client")
		hostID := laptop.hostID()
		pairing := func(confirmed, revoked bool, token, locale string) string {
			c := w.r.db.RelayPairing.Create().SetUserID(w.adaID).SetHostID(hostID).SetDeviceName("p").SetDeviceKeyHash(w.r.pairings.deviceHash(keyA))
			if confirmed {
				c.SetConfirmedAt(time.Now())
			}
			if revoked {
				c.SetRevokedAt(time.Now())
			}
			if token != "" {
				c.SetPushToken(token)
			}
			if locale != "" {
				c.SetPushLocale(locale)
			}
			return c.SaveX(context.Background()).ID
		}
		zh := pairing(true, false, "ExponentPushToken[zh]", "zh-Hans-CN")
		pairing(true, false, "ExponentPushToken[en]", "")
		pairing(false, false, "ExponentPushToken[pending]", "")
		pairing(true, true, "ExponentPushToken[revoked]", "")
		pairing(true, false, "", "")
		connected := pairing(true, false, "ExponentPushToken[connected]", "")

		// The connected phone is using its pairing, so it already shows the card.
		phone := w.phone(w.adaPhone)
		phone.send(sealed(connected, "ciphertext"))
		laptop.next(is("sealed"))

		laptop.send(obj{"t": "waiting"})
		batch := w.waitPushed(1)[0]
		to := map[string]edition.PushMessage{}
		for _, m := range batch {
			to[m.To] = m
		}
		if len(to) != 2 || to["ExponentPushToken[zh]"].To == "" || to["ExponentPushToken[en]"].To == "" {
			t.Fatalf("pushed to %v", batch)
		}
		toZh := to["ExponentPushToken[zh]"]
		if toZh.Title != "laptop" || toZh.Data["pairingId"] != zh || toZh.Data["sessionId"] != "" ||
			!strings.Contains(toZh.Body, "laptop") || strings.Contains(toZh.Body, "has a question") {
			t.Fatalf("zh %+v", toZh)
		}
		if body := to["ExponentPushToken[en]"].Body; body != "The agent on laptop needs your attention." {
			t.Fatalf("en %q", body)
		}

		// Repeated notifications cannot leak or distinguish session ids or question types.
		laptop.send(obj{"t": "waiting"})
		laptop.send(obj{"t": "waiting"})
		time.Sleep(100 * time.Millisecond)
		w.mu.Lock()
		defer w.mu.Unlock()
		if len(w.pushed) != 1 {
			t.Fatalf("pushed %d batches", len(w.pushed))
		}
		for _, m := range w.pushed[0] {
			if len(m.Data) != 1 {
				t.Fatalf("leaked notification data %+v", m.Data)
			}
		}

	})
}

func (w *world) waitPushed(n int) [][]edition.PushMessage {
	w.t.Helper()
	for range 200 {
		w.mu.Lock()
		if len(w.pushed) >= n {
			out := append([][]edition.PushMessage(nil), w.pushed...)
			w.mu.Unlock()
			return out
		}
		w.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	w.t.Fatalf("pushed %d batches, want %d", len(w.pushed), n)
	return nil
}

func TestPairingAttemptLimit(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		for i := 0; i < 10; i++ {
			if status, _ := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": "ABCDEF", "deviceName": "phone"}); status != 400 {
				t.Fatalf("attempt %d: %d", i, status)
			}
		}
		if status, _ := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": "ABCDEF", "deviceName": "phone"}); status != 429 {
			t.Fatalf("limited attempt: %d", status)
		}
	})
}

// Account sign-in never grants access to another handset's routing/control plane.
func TestPhoneDeviceIsolation(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		host := w.host(w.ada, "isolated-host")
		offer := host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		status, body := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": offer, "deviceName": "Phone A"})
		if status != 201 {
			t.Fatalf("redeem %d %v", status, body)
		}
		id := body["pairing"].(obj)["id"].(string)
		host.next(is("paired"))
		a := w.phone(w.adaPhone)
		other := handset{w.in.Bearer(w.adaID), keyB}
		b := w.phone(other)
		for _, confirmed := range []bool{false, true} {
			if confirmed {
				host.ask(obj{"t": "decide", "pairingId": id, "accept": true})
			}
			_, listed := w.call(other, "GET", "/relay/pairings", nil)
			equal(t, listed["pairings"], []any{})
			if status, _ := w.call(other, "DELETE", "/relay/pairings/"+id, nil); status != 404 {
				t.Fatalf("other phone revoke %d", status)
			}
			// In particular, pending pairing traffic MUST reach the desktop before safety-code approval.
			a.send(sealed(id, "authorized-record"))
			host.next(is("sealed"))
			for _, kind := range []string{"commit", "reveal", "noise", "data"} {
				packet := sealed(id, "other-phone-record")
				packet["kind"] = kind
				b.send(packet)
				equal(t, b.next(is("error")), obj{"t": "error", "pairingId": id, "error": "not_paired"})
			}
			a.none(is("detached"))
			host.none(is("detach"))
			host.none(is("revoked"))
			host.none(is("sealed"))
			host.send(sealed(id, "only-phone-a"))
			equal(t, a.next(is("sealed"))["data"], "only-phone-a")
			b.none(is("sealed"))
		}
		// Missing/invalid credentials fail closed even when the account token is valid.
		for _, key := range []string{"", "short", strings.Repeat("/", 43), strings.Repeat("A", 129)} {
			if status, _ := w.call(handset{w.ada, key}, "GET", "/relay/pairings", nil); status != 400 {
				t.Fatalf("invalid credential HTTP %d", status)
			}
			if code := w.phone(handset{w.ada, key}).code; code != closeBadHello {
				t.Fatalf("invalid credential socket %d", code)
			}
		}
		if status, _ := w.call(handset{w.ada, ""}, "POST", "/relay/pair", obj{"code": "ABCDEF", "deviceName": "no key", "deviceKey": keyA}); status != 400 {
			t.Fatalf("missing redeem key %d", status)
		}
		// Even knowing the credential cannot cross the account boundary.
		_, listed := w.call(handset{w.bob, keyA}, "GET", "/relay/pairings", nil)
		equal(t, listed["pairings"], []any{})
		// Unbound legacy rows grant no access to either handset, even if directly inserted.
		legacy := w.r.db.RelayPairing.Create().SetUserID(w.adaID).SetHostID(host.hostID()).
			SetDeviceName("legacy").SetConfirmedAt(time.Now()).SaveX(context.Background())
		a.send(sealed(legacy.ID, "unbound"))
		equal(t, a.next(is("error"))["error"], "not_paired")
		if status, _ := w.call(w.adaPhone, "DELETE", "/relay/pairings/"+legacy.ID, nil); status != 404 {
			t.Fatalf("unbound revoke %d", status)
		}
		// Token renewal on the original handset retains its pairing.
		_, listed = w.call(handset{w.in.Bearer(w.adaID), keyA}, "GET", "/relay/pairings", nil)
		if len(listed["pairings"].([]any)) != 1 {
			t.Fatal("original handset lost its pairing")
		}
		// Both handsets may independently pair with the same desktop without sharing a pairing.
		offer = host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		status, body = w.call(other, "POST", "/relay/pair", obj{"code": offer, "deviceName": "Phone B"})
		if status != 201 {
			t.Fatalf("second handset redeem %d", status)
		}
		bid := body["pairing"].(obj)["id"].(string)
		host.next(is("paired"))
		b.send(sealed(bid, "own-pending-handshake"))
		host.next(is("sealed"))
		host.ask(obj{"t": "decide", "pairingId": bid, "accept": true})
		_, listed = w.call(other, "GET", "/relay/pairings", nil)
		if got := listed["pairings"].([]any); len(got) != 1 || got[0].(obj)["id"] != bid {
			t.Fatalf("other handset list %v", got)
		}
		_, listed = w.call(w.adaPhone, "GET", "/relay/pairings", nil)
		if got := listed["pairings"].([]any); len(got) != 1 || got[0].(obj)["id"] != id {
			t.Fatalf("original handset list %v", got)
		}
		if status, _ := w.call(w.adaPhone, "DELETE", "/relay/pairings/"+bid, nil); status != 404 {
			t.Fatalf("cross-handset revoke %d", status)
		}

	})
}

// A phone turns one pairing's notifications on or off after pairing, and only
// for its own pairing: the token never comes back, and the list says only
// whether it is set.
func TestSetPush(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		host := w.host(w.ada, "push-settings")
		offer := host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		status, body := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": offer, "deviceName": "Phone A"})
		if status != 201 {
			t.Fatalf("redeem %d %v", status, body)
		}
		id := body["pairing"].(obj)["id"].(string)
		host.next(is("paired"))
		host.ask(obj{"t": "decide", "pairingId": id, "accept": true})
		listed := func() obj {
			_, got := w.call(w.adaPhone, "GET", "/relay/pairings", nil)
			return got["pairings"].([]any)[0].(obj)
		}
		stored := func() *ent.RelayPairing { return w.r.db.RelayPairing.GetX(context.Background(), id) }
		if got := listed(); got["push"] != false {
			t.Fatalf("paired without a token: %v", got)
		}
		if got := discovered(w); got["push"] != true {
			t.Fatalf("a server that delivers says %v", got)
		}

		path := "/relay/pairings/" + id + "/push"
		if s, _ := w.call(w.adaPhone, "PUT", path, obj{"pushToken": "ExponentPushToken[later]", "locale": "zh-CN"}); s != 204 {
			t.Fatalf("turn on %d", s)
		}
		if got, p := listed(), stored(); got["push"] != true || got["pushToken"] != nil ||
			p.PushToken == nil || *p.PushToken != "ExponentPushToken[later]" || p.PushLocale == nil || *p.PushLocale != "zh-CN" {
			t.Fatalf("on: listed %v, stored %v %v", got, p.PushToken, p.PushLocale)
		}
		host.send(obj{"t": "waiting"})
		if batch := w.waitPushed(1)[0]; len(batch) != 1 || batch[0].To != "ExponentPushToken[later]" {
			t.Fatalf("pushed %+v", batch)
		}

		// A token without a language drops the old language with it.
		if s, _ := w.call(w.adaPhone, "PUT", path, obj{"pushToken": "ExpoPushToken[next]"}); s != 204 {
			t.Fatalf("new token %d", s)
		}
		if p := stored(); p.PushToken == nil || *p.PushToken != "ExpoPushToken[next]" || p.PushLocale != nil {
			t.Fatalf("new token stored %v %v", p.PushToken, p.PushLocale)
		}
		if s, _ := w.call(w.adaPhone, "PUT", path, obj{"pushToken": nil}); s != 204 {
			t.Fatalf("turn off %d", s)
		}
		if got, p := listed(), stored(); got["push"] != false || p.PushToken != nil || p.PushLocale != nil {
			t.Fatalf("off: listed %v, stored %v %v", got, p.PushToken, p.PushLocale)
		}

		// Nothing else reaches the pairing: another handset of the same account, another account, a forged token.
		for _, h := range []handset{{w.in.Bearer(w.adaID), keyB}, w.bobPhone, {"forged", keyA}} {
			if s, _ := w.call(h, "PUT", path, obj{"pushToken": "ExponentPushToken[stolen]"}); s != 404 && s != 401 {
				t.Fatalf("someone else's handset %d", s)
			}
		}
		if p := stored(); p.PushToken != nil {
			t.Fatalf("someone else set %v", *p.PushToken)
		}
		for _, bad := range []obj{{}, {"pushToken": "not a token"}, {"pushToken": 1}, {"pushToken": "ExpoPushToken[x]", "locale": strings.Repeat("x", 21)}} {
			if s, _ := w.call(w.adaPhone, "PUT", path, bad); s != 400 {
				t.Fatalf("%v: %d", bad, s)
			}
		}

		// A revoked pairing is gone for this too.
		if s, _ := w.call(w.adaPhone, "DELETE", "/relay/pairings/"+id, nil); s != 204 {
			t.Fatalf("revoke %d", s)
		}
		if s, _ := w.call(w.adaPhone, "PUT", path, obj{"pushToken": "ExponentPushToken[late]"}); s != 404 {
			t.Fatalf("revoked %d", s)
		}
	})
}

// A server the edition gave no way to deliver, as a self-hosted one, says so,
// keeps no token, and notifies nobody; a phone may still turn notifications
// off.
func TestNoPush(t *testing.T) {
	eachWith(t, false, func(t *testing.T, w *world) {
		if got := discovered(w); got["push"] != false {
			t.Fatalf("a server that delivers nothing says %v", got)
		}
		host := w.host(w.ada, "no-push-client")
		offer := host.ask(obj{"t": "offer"})["value"].(obj)["code"]
		status, body := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": offer, "deviceName": "Phone A"})
		if status != 201 {
			t.Fatalf("redeem %d %v", status, body)
		}
		id := body["pairing"].(obj)["id"].(string)
		host.next(is("paired"))
		host.ask(obj{"t": "decide", "pairingId": id, "accept": true})

		path := "/relay/pairings/" + id + "/push"
		if s, got := w.call(w.adaPhone, "PUT", path, obj{"pushToken": "ExponentPushToken[here]", "locale": "en"}); s != 409 || got["error"] != "push_unavailable" {
			t.Fatalf("turn on %d %v", s, got)
		}
		if p := w.r.db.RelayPairing.GetX(context.Background(), id); p.PushToken != nil {
			t.Fatalf("kept %v", *p.PushToken)
		}
		if s, _ := w.call(w.adaPhone, "PUT", path, obj{"pushToken": nil}); s != 204 {
			t.Fatalf("turn off %d", s)
		}
		// A waiting agent is no error and no notification.
		host.send(obj{"t": "waiting"})
		time.Sleep(100 * time.Millisecond)
		w.mu.Lock()
		defer w.mu.Unlock()
		if len(w.pushed) != 0 {
			t.Fatalf("pushed %v", w.pushed)
		}
	})
}

// discovered is GET /api/relay, which needs no sign-in.
func discovered(w *world) obj {
	w.t.Helper()
	res, err := http.Get(w.in.URL + "/api/relay")
	if err != nil {
		w.t.Fatal(err)
	}
	defer res.Body.Close()
	var out obj
	if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&out) != nil {
		w.t.Fatalf("discover %d", res.StatusCode)
	}
	return out
}

// A phone that stops reading holds up none of its computer's frames for the
// member's other devices, and is closed once too much waits for it.
func TestSlowPhone(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		// The test relay's ping (200ms) is meant to find dead sockets fast; here
		// a peer busy writing megabytes, slower still under -race, must not be one.
		w.r.pingEvery = 5 * time.Second
		laptop := w.host(w.ada, "slow-client")
		fast := w.paired(w.adaID, laptop.hostID(), true)
		other := handset{w.ada, keyB}
		slowPairing, err := w.r.db.RelayPairing.Create().SetUserID(w.adaID).SetHostID(laptop.hostID()).SetDeviceName("tablet").
			SetDeviceKeyHash(w.r.pairings.deviceHash(keyB)).SetConfirmedAt(time.Now()).Save(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		phone := w.phone(w.adaPhone)
		phone.send(sealed(fast, "open"))
		laptop.next(is("sealed"))

		// The slow handset reads its welcome and then nothing.
		url := strings.Replace(w.in.URL, "http", "ws", 1) + "/relay/phone"
		slow, _, err := websocket.Dial(context.Background(), url, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer slow.CloseNow()
		slow.SetReadLimit(maxFrameBytes * 2)
		hello, _ := json.Marshal(obj{"t": "hello", "token": other.token, "deviceKey": other.key})
		slow.Write(context.Background(), websocket.MessageText, hello)
		slow.Read(context.Background())
		slow.Write(context.Background(), websocket.MessageBinary, sealedFrame(sealed(slowPairing.ID, "open")))
		laptop.next(is("sealed"))

		big := strings.Repeat("x", 500000)
		for range 48 {
			laptop.send(sealed(slowPairing.ID, big))
		}
		laptop.send(sealed(fast, "still-quick"))
		start := time.Now()
		equal(t, phone.next(is("sealed"))["data"], "still-quick")
		if waited := time.Since(start); waited > time.Second {
			t.Fatalf("the fast phone waited %v", waited)
		}

		// What waited for the slow one passed its limit: it is closed, and told why once it reads.
		deadline, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for {
			if _, _, err := slow.Read(deadline); err != nil {
				if code := websocket.CloseStatus(err); code != closeTooSlow {
					t.Fatalf("slow phone closed with %d (%v)", code, err)
				}
				break
			}
		}
	})
}

// Either end may ask whether its socket still carries frames.
func TestPing(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		laptop := w.host(w.ada, "ping-client")
		laptop.send(obj{"t": "ping"})
		equal(t, laptop.next(is("pong")), obj{"t": "pong"})
		phone := w.phone(w.adaPhone)
		phone.send(obj{"t": "ping"})
		equal(t, phone.next(is("pong")), obj{"t": "pong"})
	})
}

// A member's phones hear when one of their computers connects or leaves, and
// another member's do not.
func TestPresence(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		phone := w.phone(w.adaPhone)
		other := w.phone(w.bobPhone)
		laptop := w.host(w.ada, "presence-client")
		equal(t, phone.next(is("presence")), obj{"t": "presence", "hostId": laptop.hostID()})
		// A pairing confirmed at the computer, or revoked from another device, is a change to list too.
		pairing := w.paired(w.adaID, laptop.hostID(), false)
		laptop.ask(obj{"t": "decide", "pairingId": pairing, "accept": true})
		equal(t, phone.next(is("presence")), obj{"t": "presence", "hostId": laptop.hostID()})
		if status, _ := w.call(w.adaPhone, "DELETE", "/relay/pairings/"+pairing, nil); status != 204 {
			t.Fatalf("revoke %d", status)
		}
		equal(t, phone.next(is("presence")), obj{"t": "presence", "hostId": laptop.hostID()})
		laptop.c.Close(websocket.StatusNormalClosure, "")
		equal(t, phone.next(is("presence")), obj{"t": "presence", "hostId": laptop.hostID()})
		other.none(is("presence"))
	})
}

// A pong goes ahead of the frames already waiting for its socket.
func TestPongJumpsTheQueue(t *testing.T) {
	s := &socket{wake: make(chan struct{}, 1)}
	s.sendBinary([]byte("record-1"))
	s.sendBinary([]byte("record-2"))
	s.sendFirst(pong)
	if got := string(s.queue[0].b); got != `{"t":"pong"}` || s.queue[0].kind != websocket.MessageText {
		t.Fatalf("first queued: %s", got)
	}
	if string(s.queue[1].b) != "record-1" || string(s.queue[2].b) != "record-2" {
		t.Fatal("the records lost their order")
	}
}
