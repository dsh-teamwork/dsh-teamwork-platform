package httpapi_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// gate is an edition's account verification (ADR 0059): one switch for every
// personal sign-in, and single-use proofs bound to a login and a challenge.
type gate struct {
	mu       sync.Mutex
	required bool
	proofs   map[string]bool
}

func (g *gate) Required(context.Context, string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.required, nil
}

func (g *gate) ConsumeAppProof(_ context.Context, user, session, challenge string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	key := user + "|" + session + "|" + challenge
	ok := g.proofs[key]
	delete(g.proofs, key)
	return ok, nil
}

func (g *gate) prove(user, session, challenge string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.proofs[user+"|"+session+"|"+challenge] = true
}

func (g *gate) require(on bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.required = on
}

// login is the identity an edition sees for a credential: the digest of the token.
func login(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

const adaPassword = "correct horse battery"

// With verification on, no door issues a browser session or a plugin code on
// the first factor alone; a phone's first factor reaches only its own
// challenge, and only with a proof for that login.
func TestSignInGate(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		g := &gate{proofs: map[string]bool{}}
		e := start(t, d, options{gate: g})
		owner := e.admin("ada@example.com")
		userID := must(t, owner.get("/api/auth/session"), 200)["user"].(map[string]any)["id"].(string)
		g.require(true)

		// The browser: a pending login reaches nothing until the edition completes it.
		b := e.browser()
		must(t, b.post("/api/auth/password/sign-in", map[string]string{"email": "ada@example.com", "password": adaPassword}), 200)
		if s := must(t, b.get("/api/auth/session"), 200); s["user"] != nil || s["pendingVerification"] != true {
			t.Fatalf("pending login: %v", s)
		}
		if r := b.get("/api/teams"); r.status != http.StatusUnauthorized {
			t.Fatalf("a pending login read teams: %d", r.status)
		}
		if r := b.post("/api/auth/plugin/code", map[string]string{"challenge": auth.ChallengeOf(strings.Repeat("d", 43))}); r.status != http.StatusUnauthorized {
			t.Fatalf("a pending login authorized the plugin: %d %s", r.status, r.body)
		}
		if r := do(t, b.client, "POST", e.url+"/test/complete", nil, nil); r.status != http.StatusNoContent {
			t.Fatalf("complete: %d", r.status)
		}
		if s := must(t, b.get("/api/auth/session"), 200); s["user"] == nil || s["pendingVerification"] == true {
			t.Fatalf("completed login: %v", s)
		}
		if r := do(t, e.browser().client, "POST", e.url+"/test/complete", nil, nil); r.status != http.StatusUnauthorized {
			t.Fatalf("completed with no pending login: %d", r.status)
		}

		// The phone: the first factor is scoped to the challenge it was started for.
		verifier := strings.Repeat("p", 43)
		challenge := auth.ChallengeOf(verifier)
		next := "/plugin?challenge=" + challenge + "&redirect_uri=" + url.QueryEscape(wire.AppReturn)
		phone := e.browser()
		must(t, phone.post("/api/auth/password/sign-in?next="+url.QueryEscape(next), map[string]string{"email": "ada@example.com", "password": adaPassword}), 200)
		s := must(t, phone.get("/api/auth/session"), 200)
		if s["user"] != nil || s["pendingVerification"] == true || s["appChallenge"] != challenge {
			t.Fatalf("phone login: %v", s)
		}
		code := func(c, redirect string) response {
			body := map[string]string{"challenge": c}
			if redirect != "" {
				body["redirectUri"] = redirect
			}
			return phone.post("/api/auth/plugin/code", body)
		}
		if r := code(challenge, wire.AppReturn); r.code() != "verification_required" {
			t.Fatalf("handoff without a proof: %d %s", r.status, r.body)
		}
		if r := code(challenge, ""); r.status != http.StatusUnauthorized {
			t.Fatalf("the phone's first factor authorized the DSH plugin: %d %s", r.status, r.body)
		}
		other := auth.ChallengeOf(strings.Repeat("o", 43))
		g.prove(userID, login(phone.cookie("dsh-teamwork-session-app")), other)
		if r := code(other, wire.AppReturn); r.status != http.StatusUnauthorized {
			t.Fatalf("the phone's first factor reached another challenge: %d %s", r.status, r.body)
		}
		g.prove(userID, login(owner.cookie("dsh-teamwork-session")), challenge)
		if r := code(challenge, wire.AppReturn); r.code() != "verification_required" {
			t.Fatalf("a proof for another login was accepted: %d %s", r.status, r.body)
		}
		g.prove(userID, login(phone.cookie("dsh-teamwork-session-app")), challenge)
		minted := must(t, code(challenge, wire.AppReturn), 200)["code"].(string)
		must(t, do(t, http.DefaultClient, "POST", e.url+"/api/auth/plugin/token", map[string]string{"code": minted, "verifier": verifier}, nil), 200)
		if phone.cookie("dsh-teamwork-session-app") != "" {
			t.Fatal("the phone's pending login outlived its handoff")
		}

		// Verification off: the same first factor completes without a proof.
		g.require(false)
		free := e.browser()
		must(t, free.post("/api/auth/password/sign-in?next="+url.QueryEscape(next), map[string]string{"email": "ada@example.com", "password": adaPassword}), 200)
		must(t, free.post("/api/auth/plugin/code", map[string]string{"challenge": challenge, "redirectUri": wire.AppReturn}), 200)
	})
}

// Signing out always ends the browser's login, even when an edition's cleanup
// fails, and the cleanup sees the login that is ending.
func TestSignOutSurvivesEditionCleanup(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		var seen []string
		failing := func(_ context.Context, who *edition.Identity) error {
			seen = append(seen, who.SessionID)
			return errors.New("grant store unavailable")
		}
		e := start(t, d, options{gate: &gate{proofs: map[string]bool{}}, signOuts: []func(context.Context, *edition.Identity) error{failing}})
		b := e.admin("ada@example.com")
		session := login(b.cookie("dsh-teamwork-session"))
		must(t, b.post("/api/auth/sign-out", nil), 204)
		if s := must(t, b.get("/api/auth/session"), 200); s["user"] != nil {
			t.Fatalf("still signed in: %v", s)
		}
		if len(seen) != 1 || seen[0] != session {
			t.Fatalf("cleanup saw %v, want the login %s", seen, session)
		}
	})
}
