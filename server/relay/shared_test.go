package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

type sharedWorld struct {
	t      *testing.T
	in     *editiontest.Instance
	r      *relay
	teamID string
	admin  *http.Cookie
	member *http.Cookie
	other  *http.Cookie // an admin of another team
	// The three accounts' ids, in the same order.
	adminID, memberID, otherID string
	// denied holds the teams the edition's gate keeps from running a Team DSH.
	denied map[string]bool
}

func eachShared(t *testing.T, f func(t *testing.T, w *sharedWorld)) {
	w := &sharedWorld{denied: map[string]bool{}}
	ext := edition.Extension{
		Name: "open-relay",
		Mount: func(h edition.Host) (func(), error) {
			if err := h.GateTeamDSH(func(_ context.Context, teamID string) (bool, error) { return !w.denied[teamID], nil }); err != nil {
				return nil, err
			}
			w.r = newRelay(h, 200*time.Millisecond, true)
			if err := h.SubscribeTeams(w.r.teamChanged); err != nil {
				return nil, err
			}
			w.r.routes(h.Mux)
			w.r.sharedRoutes(h.Mux)
			w.r.accessRoutes(h.Mux)
			w.r.archiveRoutes(h.Mux)
			return w.r.close, nil
		},
	}
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		w.t, w.in = t, in
		adminID, memberID, otherID := in.Account("ada@example.test"), in.Account("bob@example.test"), in.Account("eve@example.test")
		w.teamID = in.Team(adminID)
		in.Member(w.teamID, memberID)
		in.Team(otherID)
		w.admin, w.member, w.other = in.Session(adminID, "password"), in.Session(memberID, "password"), in.Session(otherID, "password")
		w.adminID, w.memberID, w.otherID = adminID, memberID, otherID
		clear(w.denied)
		f(t, w)
	})
}

func (w *sharedWorld) do(method, path string, cookie *http.Cookie, bearer string, body any) (int, obj) {
	w.t.Helper()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, w.in.URL+path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Origin", w.in.URL)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		w.t.Fatal(err)
	}
	defer res.Body.Close()
	var out obj
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// exchange is the plugin's side: a nonce, signed by machine, traded with the
// key for a host token.
func (w *sharedWorld) exchange(key string, machine ed25519.PrivateKey) (int, obj) {
	w.t.Helper()
	status, challenge := w.do("POST", "/relay/shared/challenge", nil, "", obj{"key": key})
	if status != 200 {
		return status, challenge
	}
	nonce := challenge["nonce"].(string)
	sig := ed25519.Sign(machine, signedExchange(nonce, hostKeyID(key), w.in.URL))
	return w.do("POST", "/relay/shared/token", nil, "", obj{"key": key, "nonce": nonce,
		"publicKey": base64.StdEncoding.EncodeToString(machine.Public().(ed25519.PublicKey)), "signature": base64.StdEncoding.EncodeToString(sig)})
}

func machine(t *testing.T) ed25519.PrivateKey {
	_, k, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// A team admin creates a shared host's key; the first machine to exchange it
// keeps it, and a host token signs that machine in for the team alone.
func TestSharedHostKeyBindsOneMachineToOneTeam(t *testing.T) {
	eachShared(t, func(t *testing.T, w *sharedWorld) {
		base := "/api/teams/" + w.teamID + "/shared-hosts"
		if s, out := w.do("POST", base, w.member, "", obj{"name": "Build box"}); s != 403 {
			t.Fatalf("a member created a shared host: %d %v", s, out)
		}
		if s, _ := w.do("POST", base, w.other, "", obj{"name": "Build box"}); s != 404 {
			t.Fatalf("another team's admin: %d", s)
		}
		s, created := w.do("POST", base, w.admin, "", obj{"name": "Build box"})
		if s != 201 {
			t.Fatalf("create: %d %v", s, created)
		}
		key := created["key"].(string)
		hostID := created["host"].(obj)["id"].(string)
		if hostKeyID(key) != hostID || created["host"].(obj)["bound"] != false {
			t.Fatalf("created %v", created)
		}

		// The first machine binds it, and its token syncs the team as no member.
		first, second := machine(t), machine(t)
		s, token := w.exchange(key, first)
		if s != 200 || token["teamId"] != w.teamID || token["hostId"] != hostID {
			t.Fatalf("exchange: %d %v", s, token)
		}
		s, snap := w.do("GET", "/api/configs", nil, token["token"].(string), nil)
		if teams, _ := snap["teams"].([]any); s != 200 || len(teams) != 1 || teams[0].(obj)["teamId"] != w.teamID {
			t.Fatalf("host token synced %d %v", s, snap)
		}
		if s, _ := w.do("GET", "/api/profile", nil, token["token"].(string), nil); s != 401 {
			t.Fatalf("a host token opened a person's route: %d", s)
		}
		if s, out := w.exchange(key, first); s != 200 {
			t.Fatalf("the bound machine renews: %d %v", s, out)
		}

		// The same key on another machine is refused.
		if s, out := w.exchange(key, second); s != 403 || out["error"] != "host_bound_elsewhere" {
			t.Fatalf("a copied key: %d %v", s, out)
		}

		// A signature over another nonce, or a key with a wrong secret, is refused.
		_, challenge := w.do("POST", "/relay/shared/challenge", nil, "", obj{"key": key})
		stale := ed25519.Sign(first, signedExchange("1.forged", hostID, w.in.URL))
		if s, _ := w.do("POST", "/relay/shared/token", nil, "", obj{"key": key, "nonce": challenge["nonce"],
			"publicKey": base64.StdEncoding.EncodeToString(first.Public().(ed25519.PublicKey)), "signature": base64.StdEncoding.EncodeToString(stale)}); s != 401 {
			t.Fatalf("a signature over another nonce: %d", s)
		}
		forged := hostKeyPrefix + hostID + "_" + base64.RawURLEncoding.EncodeToString(make([]byte, 32))
		if s, _ := w.exchange(forged, first); s != 401 {
			t.Fatalf("a forged secret: %d", s)
		}

		// Rotating keeps the machine and retires the old key.
		s, rotated := w.do("POST", base+"/"+hostID+"/rotate", w.admin, "", obj{})
		if s != 200 || rotated["host"].(obj)["bound"] != true {
			t.Fatalf("rotate: %d %v", s, rotated)
		}
		if s, _ := w.exchange(key, first); s != 401 {
			t.Fatalf("the old key after rotation: %d", s)
		}
		if s, _ := w.exchange(rotated["key"].(string), first); s != 200 {
			t.Fatalf("the new key on the bound machine: %d", s)
		}

		// The admin lists and renames it; another team cannot see it.
		if s, out := w.do("PATCH", base+"/"+hostID, w.admin, "", obj{"name": "Shared box"}); s != 200 || out["host"].(obj)["name"] != "Shared box" {
			t.Fatalf("rename: %d %v", s, out)
		}
		if s, out := w.do("GET", base, w.admin, "", nil); s != 200 || len(out["hosts"].([]any)) != 1 {
			t.Fatalf("list: %d %v", s, out)
		}
		if s, _ := w.do("DELETE", "/api/teams/"+w.teamID+"/shared-hosts/"+hostID, w.other, "", nil); s != 404 {
			t.Fatalf("another team's admin deleted it: %d", s)
		}

		// Deleting it stops its key at once.
		if s, _ := w.do("DELETE", base+"/"+hostID, w.admin, "", nil); s != 204 {
			t.Fatalf("delete: %d", s)
		}
		if s, _ := w.exchange(rotated["key"].(string), first); s != 401 {
			t.Fatalf("a deleted host's key: %d", s)
		}
		if n := w.r.db.SharedHost.Query().CountX(context.Background()); n != 0 {
			t.Fatalf("%d shared hosts left", n)
		}
	})
}

// Members reach a shared DSH through the relay by the server's list: the
// DSH's socket proves itself with its host token and hears who may reach it;
// a member's handset joins pending; a member taken off the list loses the
// pairing at once; deleting the host closes its socket.
func TestMembersReachASharedDSHByTheServersList(t *testing.T) {
	eachShared(t, func(t *testing.T, w *sharedWorld) {
		rw := &world{t: t, in: w.in, r: w.r}
		base := "/api/teams/" + w.teamID + "/shared-hosts"
		_, created := w.do("POST", base, w.admin, "", obj{"name": "Build box"})
		hostID, key := created["host"].(obj)["id"].(string), created["key"].(string)
		_, token := w.exchange(key, machine(t))

		dsh := rw.open("/relay/plugin", obj{"t": "hello", "token": token["token"], "clientId": "shared-box-1", "name": "box", "dshVersion": "0.2.2-rc.3"})
		if dsh.hostID() != hostID {
			t.Fatalf("a shared DSH's relay host is %v, not its shared host %s", dsh.welcome, hostID)
		}
		if members := dsh.next(is("members"))["members"].([]any); len(members) != 2 {
			t.Fatalf("members %v", members)
		}
		if reply := dsh.ask(obj{"t": "offer"}); reply["error"] != "shared_host" {
			t.Fatalf("a shared DSH was given a pairing code: %v", reply)
		}

		member := handset{w.in.Bearer(w.memberID), keyA}
		outsider := handset{w.in.Bearer(w.otherID), keyB}
		if s, out := rw.call(member, "GET", "/relay/shared", nil); s != 200 || len(out["hosts"].([]any)) != 1 || out["hosts"].([]any)[0].(obj)["online"] != true {
			t.Fatalf("reachable: %d %v", s, out)
		}
		if _, out := rw.call(outsider, "GET", "/relay/shared", nil); len(out["hosts"].([]any)) != 0 {
			t.Fatalf("an outsider sees %v", out)
		}
		if s, _ := rw.call(outsider, "POST", "/relay/shared/"+hostID+"/join", obj{"deviceName": "eve"}); s != 404 {
			t.Fatalf("an outsider joined: %d", s)
		}
		s, joined := rw.call(member, "POST", "/relay/shared/"+hostID+"/join", obj{"deviceName": "bob's phone"})
		if s != 201 || joined["pairing"].(obj)["status"] != "pending" {
			t.Fatalf("join: %d %v", s, joined)
		}
		pairingID := joined["pairing"].(obj)["id"].(string)
		dsh.next(is("paired"))

		// The pending pairing carries the handshake to the DSH and back.
		phone := rw.phone(member)
		phone.send(sealed(pairingID, "invite-handshake"))
		equal(t, dsh.next(is("sealed")), sealed(pairingID, "invite-handshake"))

		// Listed with the admin alone: the member's pairing ends, and the DSH hears the new list.
		if s, out := w.do("PUT", base+"/"+hostID+"/members", w.admin, "", obj{"access": "listed", "userIds": []string{w.adminID}}); s != 200 || out["host"].(obj)["access"] != "listed" {
			t.Fatalf("set members: %d %v", s, out)
		}
		if members := dsh.next(func(f obj) bool { return f["t"] == "members" && len(f["members"].([]any)) == 1 }); members == nil {
			t.Fatal("no new list")
		}
		phone.next(func(f obj) bool { return f["t"] == "revoked" && f["pairingId"] == pairingID })
		if s, _ := rw.call(member, "POST", "/relay/shared/"+hostID+"/join", obj{"deviceName": "again"}); s != 404 {
			t.Fatalf("an unlisted member joined: %d", s)
		}
		if s, _ := w.do("PUT", base+"/"+hostID+"/members", w.admin, "", obj{"access": "listed", "userIds": []string{w.otherID}}); s != 400 {
			t.Fatalf("listed someone outside the team: %d", s)
		}

		// Deleting the host closes its socket.
		w.do("DELETE", base+"/"+hostID, w.admin, "", nil)
		select {
		case <-dsh.closed:
		case <-time.After(5 * time.Second):
			t.Fatal("the deleted host's socket stayed open")
		}
	})
}

// A browser on the site reaches the relay by its session cookie: reads, and
// writes from this origin; its socket only when the upgrade came from a page
// here. A page elsewhere, or an account with an unchanged first password, is
// nobody.
func TestABrowserReachesTheRelayByItsSession(t *testing.T) {
	eachShared(t, func(t *testing.T, w *sharedWorld) {
		rw := &world{t: t, in: w.in, r: w.r}
		base := "/api/teams/" + w.teamID + "/shared-hosts"
		_, created := w.do("POST", base, w.admin, "", obj{"name": "Build box"})
		hostID, key := created["host"].(obj)["id"].(string), created["key"].(string)
		_, token := w.exchange(key, machine(t))
		dsh := rw.open("/relay/plugin", obj{"t": "hello", "token": token["token"], "clientId": "shared-box-1", "name": "box", "dshVersion": "0.2.2-rc.3"})
		dsh.next(is("members"))

		browser := func(method, path, origin string, cookie *http.Cookie, body any) int {
			t.Helper()
			data, _ := json.Marshal(body)
			req, _ := http.NewRequest(method, w.in.URL+path, bytes.NewReader(data))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", origin)
			req.Header.Set("X-Device-Key", keyA)
			req.AddCookie(cookie)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			return res.StatusCode
		}
		if s := browser("GET", "/relay/shared", w.in.URL, w.member, nil); s != 200 {
			t.Fatalf("a member's session listing: %d", s)
		}
		if s := browser("POST", "/relay/shared/"+hostID+"/join", "https://elsewhere.example", w.member, obj{"deviceName": "browser"}); s != 401 {
			t.Fatalf("a write from another site: %d", s)
		}
		if s := browser("POST", "/relay/shared/"+hostID+"/join", w.in.URL, w.member, obj{"deviceName": "browser"}); s != 201 {
			t.Fatalf("a write from this site: %d", s)
		}
		dsh.next(is("paired"))

		socket := func(origin string, cookie *http.Cookie) *peer {
			return rw.openWith("/relay/phone", http.Header{"Origin": {origin}, "Cookie": {cookie.String()}}, obj{"t": "hello", "deviceKey": keyA})
		}
		if p := socket(w.in.URL, w.member); p.welcome == nil {
			t.Fatalf("a page of this site was refused: %d", p.code)
		}
		if p := socket("https://elsewhere.example", w.member); p.welcome != nil || p.code != closeUnauthorized {
			t.Fatalf("a page elsewhere rode the cookie: %v %d", p.welcome, p.code)
		}
		w.in.FirstPassword(w.memberID)
		if p := socket(w.in.URL, w.member); p.welcome != nil || p.code != closeUnauthorized {
			t.Fatalf("a first password's session: %v %d", p.welcome, p.code)
		}
		if s := browser("GET", "/relay/shared", w.in.URL, w.member, nil); s != 401 {
			t.Fatalf("a first password's session listing: %d", s)
		}
	})
}

// raw sends a body as is, with a Bearer token.
func (w *sharedWorld) raw(path, bearer string, body []byte) (int, obj) {
	w.t.Helper()
	req, _ := http.NewRequest("POST", w.in.URL+path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+bearer)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		w.t.Fatal(err)
	}
	defer res.Body.Close()
	var out obj
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// A shared DSH's archive takes only the next segment of its chain, signed by
// the DSH's bound key, keeps it byte for byte, and gives it to the team's
// admin alone.
func TestTheArchiveKeepsOneSignedChainPerSharedDSH(t *testing.T) {
	eachShared(t, func(t *testing.T, w *sharedWorld) {
		base := "/api/teams/" + w.teamID + "/shared-hosts"
		_, created := w.do("POST", base, w.admin, "", obj{"name": "Build box"})
		hostID, key := created["host"].(obj)["id"].(string), created["key"].(string)
		dsh := machine(t)
		_, token := w.exchange(key, dsh)
		host := token["token"].(string)
		audit := strings.Repeat("ab", 32)
		segmentOf := func(seq int64, prev string, signer ed25519.PrivateKey) []byte {
			s := segment{V: 1, Host: hostID, Seq: seq, Prev: prev, Key: audit, Enc: "ZW5j", CT: base64.StdEncoding.EncodeToString([]byte("sealed records"))}
			s.Sig = base64.StdEncoding.EncodeToString(ed25519.Sign(signer, segmentSigned(s)))
			b, _ := json.Marshal(s)
			return b
		}
		first := segmentOf(1, "", dsh)
		digest := func(b []byte) string { d := sha256.Sum256(b); return hex.EncodeToString(d[:]) }

		if s, out := w.raw("/relay/shared/archive", host, segmentOf(1, "", machine(t))); s != 403 {
			t.Fatalf("a segment another key signed: %d %v", s, out)
		}
		if s, out := w.raw("/relay/shared/archive", host, segmentOf(2, "", dsh)); s != 409 || out["next"] != float64(1) {
			t.Fatalf("a segment out of order: %d %v", s, out)
		}
		if s, out := w.raw("/relay/shared/archive", host, first); s != 201 || out["digest"] != digest(first) {
			t.Fatalf("the first segment: %d %v", s, out)
		}
		if s, _ := w.raw("/relay/shared/archive", host, first); s != 200 {
			t.Fatalf("a retried upload: %d", s)
		}
		if s, _ := w.raw("/relay/shared/archive", host, segmentOf(2, strings.Repeat("0", 64), dsh)); s != 409 {
			t.Fatalf("a segment naming another previous one: %d", s)
		}
		second := segmentOf(2, digest(first), dsh)
		if s, _ := w.raw("/relay/shared/archive", host, second); s != 201 {
			t.Fatalf("the second segment: %d", s)
		}
		if s, _ := w.raw("/relay/shared/archive", "not-a-token", second); s != 401 {
			t.Fatalf("an upload without a host token: %d", s)
		}

		// The admin lists it and gets the segments back byte for byte; a member does not.
		if s, out := w.do("GET", "/api/teams/"+w.teamID+"/shared-archive", w.admin, "", nil); s != 200 || out["hosts"].([]any)[0].(obj)["segments"] != float64(2) {
			t.Fatalf("list: %d %v", s, out)
		}
		if s, _ := w.do("GET", "/api/teams/"+w.teamID+"/shared-archive", w.member, "", nil); s != 403 {
			t.Fatalf("a member read the archive: %d", s)
		}
		req, _ := http.NewRequest("GET", w.in.URL+"/api/teams/"+w.teamID+"/shared-archive/"+hostID, nil)
		req.AddCookie(w.admin)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		exported, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if string(exported) != string(first)+"\n"+string(second)+"\n" {
			t.Fatalf("export: %q", exported)
		}

		// Deleting the shared DSH keeps its archive.
		w.do("DELETE", base+"/"+hostID, w.admin, "", nil)
		if _, out := w.do("GET", "/api/teams/"+w.teamID+"/shared-archive", w.admin, "", nil); out["hosts"].([]any)[0].(obj)["deleted"] != true {
			t.Fatalf("after deleting the host: %v", out)
		}
	})
}

// A team the edition's gate does not admit cannot make, rotate or sign in a
// Team DSH, and its members reach none; admitting it again restores them.
func TestTheGateKeepsATeamFromRunningATeamDSH(t *testing.T) {
	eachShared(t, func(t *testing.T, w *sharedWorld) {
		base := "/api/teams/" + w.teamID + "/shared-hosts"
		s, created := w.do("POST", base, w.admin, "", obj{"name": "Build box"})
		if s != 201 {
			t.Fatalf("create: %d %v", s, created)
		}
		key, hostID := created["key"].(string), created["host"].(obj)["id"].(string)
		w.do("PUT", base+"/"+hostID+"/members", w.admin, "", obj{"access": "team"})

		w.denied[w.teamID] = true
		if s, out := w.do("GET", base, w.admin, "", nil); s != 200 || out["available"] != false || len(out["hosts"].([]any)) != 1 {
			t.Fatalf("list while not admitted: %d %v", s, out)
		}
		for _, call := range []struct{ method, path string }{{"POST", base}, {"POST", base + "/" + hostID + "/rotate"}} {
			if s, out := w.do(call.method, call.path, w.admin, "", obj{"name": "Again"}); s != 403 || out["error"] != "team_dsh_unavailable" {
				t.Fatalf("%s %s while not admitted: %d %v", call.method, call.path, s, out)
			}
		}
		if s, out := w.exchange(key, machine(t)); s != 403 || out["error"] != "team_dsh_unavailable" {
			t.Fatalf("token while not admitted: %d %v", s, out)
		}
		if s, out := w.do("GET", "/relay/shared", w.member, "", nil); s != 200 || len(out["hosts"].([]any)) != 0 || len(out["unavailableTeamIds"].([]any)) != 1 || out["unavailableTeamIds"].([]any)[0] != w.teamID {
			t.Fatalf("a member reached a Team DSH of a team not admitted: %d %v", s, out)
		}

		delete(w.denied, w.teamID)
		if s, out := w.do("GET", base, w.admin, "", nil); s != 200 || out["available"] != true {
			t.Fatalf("list once admitted: %d %v", s, out)
		}
		if s, out := w.exchange(key, machine(t)); s != 200 {
			t.Fatalf("token once admitted: %d %v", s, out)
		}
		if s, out := w.do("GET", "/relay/shared", w.member, "", nil); s != 200 || len(out["hosts"].([]any)) != 1 || len(out["unavailableTeamIds"].([]any)) != 0 {
			t.Fatalf("a member of an admitted team: %d %v", s, out)
		}
	})
}
