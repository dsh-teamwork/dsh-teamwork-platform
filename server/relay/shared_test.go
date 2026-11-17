package relay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
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
}

func eachShared(t *testing.T, f func(t *testing.T, w *sharedWorld)) {
	w := &sharedWorld{}
	ext := edition.Extension{
		Name: "open-relay",
		Mount: func(h edition.Host) (func(), error) {
			w.r = newRelay(h, nil, 200*time.Millisecond)
			if err := h.SubscribeTeams(w.r.teamChanged); err != nil {
				return nil, err
			}
			w.r.routes(h.Mux)
			w.r.sharedRoutes(h.Mux)
			w.r.accessRoutes(h.Mux)
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
