package httpapi_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// The whole slice, as the plugin and its admin use it, with the provider's
// key never in an answer and nothing but the allow-list reaching upstream.
func TestPluginSlice(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		s := newStub(t)
		admin := e.admin("Admin@Example.com")
		teamID, modelID := e.team(admin, s, "Core")
		p := e.pluginFor(admin)

		var answers [][]byte
		snap := p.get("/api/configs")
		answers = append(answers, snap.body)
		teams := must(t, snap, 200)["teams"].([]any)
		if len(teams) != 1 || teams[0].(map[string]any)["teamId"] != teamID || teams[0].(map[string]any)["role"] != "admin" {
			t.Fatalf("snapshot: %s", snap.body)
		}

		plain := p.post("/api/llm/chat/completions", map[string]any{"model": modelID, "messages": []any{map[string]string{"role": "user", "content": "hi"}}, "user": "drop", "base_url": "http://evil"})
		answers = append(answers, plain.body)
		must(t, plain, 200)
		if !bytes.Contains(s.last, []byte(`"max_tokens":4096`)) || bytes.Contains(s.last, []byte("drop")) || bytes.Contains(s.last, []byte("evil")) || !bytes.Contains(s.last, []byte(`"model":"stub-model"`)) {
			t.Fatalf("upstream body: %s", s.last)
		}

		res, err := http.DefaultClient.Do(func() *http.Request {
			r, _ := http.NewRequest("POST", e.url+"/api/llm/chat/completions", strings.NewReader(fmt.Sprintf(`{"model":%q,"messages":[{}],"stream":true}`, modelID)))
			r.Header.Set("Authorization", "Bearer "+p.token)
			return r
		}())
		if err != nil || res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/event-stream" || res.Header.Get("Set-Cookie") != "" {
			t.Fatalf("stream: %v %v", err, res.Header)
		}
		res.Body.Close()

		answers = append(answers, admin.get("/api/auth/session").body)
		for _, a := range answers {
			if bytes.Contains(a, []byte("sk-test-provider-key")) {
				t.Fatal("a provider key reached an answer")
			}
		}
	})
}

func TestPKCEExchange(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("a@x.io")
		verifier := strings.Repeat("q", 50)
		code := must(t, admin.post("/api/auth/plugin/code", map[string]string{"challenge": auth.ChallengeOf(verifier)}), 200)["code"].(string)
		redeem := func(code, verifier string) response {
			return do(t, http.DefaultClient, "POST", e.url+"/api/auth/plugin/token", map[string]string{"code": code, "verifier": verifier}, nil)
		}
		if r := redeem(code, strings.Repeat("w", 50)); r.status != 401 || r.code() != "invalid_code" {
			t.Fatalf("wrong verifier: %d %s", r.status, r.body)
		}
		if r := redeem(code+"x", verifier); r.status != 401 {
			t.Fatalf("tampered code: %d", r.status)
		}
		if r := redeem(code, "short"); r.status != 400 || r.code() != "invalid_request" {
			t.Fatalf("short verifier: %d %s", r.status, r.body)
		}
		tok := must(t, redeem(code, verifier), 200)["token"].(string)
		// A Bearer token is not a session cookie, and a code is not a token.
		if r := do(t, http.DefaultClient, "GET", e.url+"/api/configs", nil, map[string]string{"Authorization": "Bearer " + code}); r.status != 401 {
			t.Fatalf("a code used as a token: %d", r.status)
		}
		if r := do(t, http.DefaultClient, "POST", e.url+"/api/auth/plugin/code", map[string]string{"challenge": auth.ChallengeOf(verifier)}, map[string]string{"Authorization": "Bearer " + tok}); r.status != 401 {
			t.Fatalf("a token minted a code: %d", r.status)
		}
		// Only this server's loopback or the app's prefix may receive a code.
		if r := admin.post("/api/auth/plugin/code", map[string]string{"challenge": auth.ChallengeOf(verifier), "redirectUri": "https://evil.example/cb"}); r.status != 400 {
			t.Fatalf("foreign redirect: %d", r.status)
		}
		if r := admin.post("/api/auth/plugin/code", map[string]string{"challenge": "too-short"}); r.status != 401 {
			t.Fatalf("malformed challenge: %d", r.status)
		}
	})
}

// Ten guesses per account per window, however many arrive at once, and the
// right password does not get round a spent window.
func TestPasswordGuessLimitUnderBurst(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		e.admin("a@x.io")
		var refused, wrong atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 30; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				r := e.browser().post("/api/auth/password/sign-in", map[string]string{"email": "a@x.io", "password": "wrong password!"})
				switch r.code() {
				case "too_many_attempts":
					refused.Add(1)
				case "invalid_credentials":
					wrong.Add(1)
				default:
					t.Errorf("unexpected %d %s", r.status, r.body)
				}
			}()
		}
		wg.Wait()
		if wrong.Load() != auth.MaxFailures || refused.Load() != 30-auth.MaxFailures {
			t.Fatalf("compared %d, refused %d", wrong.Load(), refused.Load())
		}
		r := e.browser().post("/api/auth/password/sign-in", map[string]string{"email": "a@x.io", "password": "correct horse battery"})
		if r.code() != "too_many_attempts" {
			t.Fatalf("right password in a spent window: %d %s", r.status, r.body)
		}
		// An address with no account is limited the same way, so the answers
		// say nothing about which accounts exist.
		for i := 0; i < auth.MaxFailures; i++ {
			if r := e.browser().post("/api/auth/password/sign-in", map[string]string{"email": "nobody@x.io", "password": "whatever it is"}); r.code() != "invalid_credentials" {
				t.Fatalf("unknown address, guess %d: %s", i+1, r.body)
			}
		}
		if r := e.browser().post("/api/auth/password/sign-in", map[string]string{"email": "Nobody@X.io", "password": "whatever it is"}); r.code() != "too_many_attempts" {
			t.Fatalf("unknown address past the limit: %s", r.body)
		}
	})
}

// Racing for the setup link gets one account between everybody.
func TestFirstAccountRace(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		var ok atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 12; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				r := e.browser().post("/api/auth/setup", map[string]string{"token": auth.SetupToken(secret), "email": fmt.Sprintf("p%d@x.io", i), "password": "correct horse battery"})
				if r.status == http.StatusNoContent {
					ok.Add(1)
				} else if r.code() != "setup_closed" {
					t.Errorf("unexpected %d %s", r.status, r.body)
				}
			}(i)
		}
		wg.Wait()
		if n := d.Client.Password.Query().CountX(context.Background()); ok.Load() != 1 || n != 1 {
			t.Fatalf("%d claims succeeded, %d passwords", ok.Load(), n)
		}
		if r := e.browser().post("/api/auth/setup", map[string]string{"token": "wrong", "email": "z@x.io", "password": "correct horse battery"}); r.code() != "setup_closed" {
			t.Fatalf("wrong token: %s", r.body)
		}
	})
}

// A team the caller is not in is a 404, for its own requests and for a model
// id of that team; a removed member is refused on the very next request.
func TestTeamBoundaries(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		s := newStub(t)
		admin := e.admin("a@x.io")
		teamA, modelA := e.team(admin, s, "A")
		p := e.pluginFor(admin)

		// Another person, with a team of their own.
		ctx := context.Background()
		other, _ := d.Client.User.Create().SetEmail("b@x.io").Save(ctx)
		d.Client.Identity.Create().SetProvider("email").SetSubject("b@x.io").SetUserID(other.ID).ExecX(ctx)
		hash, _ := auth.HashPassword("other person password")
		d.Client.Password.Create().SetUserID(other.ID).SetHash(hash).ExecX(ctx)
		b := e.browser()
		must(t, b.post("/api/auth/password/sign-in", map[string]string{"email": "b@x.io", "password": "other person password"}), 200)
		teamB, modelB := e.team(b, s, "B")

		if r := admin.post("/api/teams/"+teamB+"/providers", map[string]string{"name": "x", "baseUrl": s.URL, "apiKey": "k"}); r.status != 404 || r.code() != "team_not_found" {
			t.Fatalf("another team's providers: %d %s", r.status, r.body)
		}
		if r := p.post("/api/llm/chat/completions", map[string]any{"model": modelB, "messages": []any{map[string]string{}}}); r.status != 403 || r.code() != "model_forbidden" {
			t.Fatalf("another team's model: %d %s", r.status, r.body)
		}
		// B joins A as a member, then is removed.
		d.Client.Membership.Create().SetUserID(other.ID).SetTeamID(teamA).SetRole(membership.RoleMember).ExecX(ctx)
		pb := e.pluginFor(b)
		must(t, pb.post("/api/llm/chat/completions", map[string]any{"model": modelA, "messages": []any{map[string]string{}}}), 200)
		if r := b.post("/api/teams/"+teamA+"/configs", map[string]any{"kind": "model", "name": "X", "data": map[string]any{"provider": "stub", "model": "m"}}); r.status != 403 || r.code() != "admin_required" {
			t.Fatalf("a member published: %d %s", r.status, r.body)
		}
		d.Client.Membership.Delete().Where(membership.UserID(other.ID), membership.TeamID(teamA)).ExecX(ctx)
		if r := pb.post("/api/llm/chat/completions", map[string]any{"model": modelA, "messages": []any{map[string]string{}}}); r.status != 403 {
			t.Fatalf("a removed member called a model: %d", r.status)
		}
		snap := must(t, pb.get("/api/configs"), 200)["teams"].([]any)
		if len(snap) != 1 || snap[0].(map[string]any)["teamId"] != teamB {
			t.Fatalf("a removed member's snapshot: %v", snap)
		}
	})
}

// The provider address rule: refused on save without the flag, and on the
// socket when a name that passed the check resolves somewhere private.
func TestProviderAddressRule(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		s := newStub(t)
		strict := start(t, d, options{})
		admin := strict.admin("a@x.io")
		teamID := must(t, admin.post("/api/teams", map[string]string{"name": "T"}), 201)["id"].(string)
		for _, url := range []string{s.URL, "http://10.0.0.1/v1", "https://169.254.169.254/", "https://[::1]/", "ftp://x.example/"} {
			r := admin.post("/api/teams/"+teamID+"/providers", map[string]string{"name": "p", "baseUrl": url, "apiKey": "k"})
			if r.status != 400 {
				t.Fatalf("%s: %d %s", url, r.status, r.body)
			}
		}

		// DNS rebinding: the name resolves public when checked and to the stub
		// (loopback) when connected. The socket refuses, so the stub is never hit.
		var calls atomic.Int32
		port := s.Listener.Addr().(interface{ String() string }).String()
		port = port[strings.LastIndex(port, ":")+1:]
		rebinding := start(t, testdb.New(t, d.Name), options{lookup: func(ctx context.Context, host string) ([]netip.Addr, error) {
			if calls.Add(1) == 1 || host != "provider.example" {
				return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
			}
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		}})
		ra := rebinding.admin("a@x.io")
		tid := must(t, ra.post("/api/teams", map[string]string{"name": "T"}), 201)["id"].(string)
		must(t, ra.post("/api/teams/"+tid+"/providers", map[string]string{"name": "stub", "baseUrl": "https://provider.example:" + port, "apiKey": "sk-test-provider-key"}), 201)
		mid := must(t, ra.post("/api/teams/"+tid+"/configs", map[string]any{"kind": "model", "name": "M", "data": map[string]any{"provider": "stub", "model": "m"}}), 201)["id"].(string)
		calls.Store(0)
		connsBefore := s.conns.Load()
		r := rebinding.pluginFor(ra).post("/api/llm/chat/completions", map[string]any{"model": mid, "messages": []any{map[string]string{}}})
		// The dialer refused the loopback answer: not even a TCP connection reached the stub.
		if r.status != 502 || r.code() != "upstream_unavailable" || s.conns.Load() != connsBefore || calls.Load() < 2 {
			t.Fatalf("rebinding: %d %s, %d connections reached the stub, %d lookups", r.status, r.body, s.conns.Load()-connsBefore, calls.Load())
		}
	})
}

// A browser session whose password an admin set reaches nothing but
// sign-in, and a write from another site is refused.
func TestBrowserGuards(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("a@x.io")
		ctx := context.Background()
		d.Client.Password.Update().SetMustChange(true).ExecX(ctx)
		if r := admin.post("/api/teams", map[string]string{"name": "T"}); r.status != 403 || r.code() != "password_change_required" {
			t.Fatalf("must change: %d %s", r.status, r.body)
		}
		if r := admin.post("/api/auth/plugin/code", map[string]string{"challenge": strings.Repeat("a", 43)}); r.code() != "password_change_required" {
			t.Fatalf("must change, plugin code: %s", r.body)
		}
		if r := admin.post("/api/auth/password/change", map[string]string{"current": "correct horse battery", "next": "short"}); r.code() != "weak_password" {
			t.Fatalf("weak: %s", r.body)
		}
		if r := admin.post("/api/auth/password/change", map[string]string{"current": "correct horse battery", "next": "a brand new password"}); r.status != 204 {
			t.Fatalf("change: %d %s", r.status, r.body)
		}
		must(t, admin.post("/api/teams", map[string]string{"name": "T"}), 201)

		admin.origin = "https://evil.example"
		if r := admin.post("/api/teams", map[string]string{"name": "T"}); r.status != 403 || r.code() != "cross_origin" {
			t.Fatalf("cross origin: %d %s", r.status, r.body)
		}
		// The same machine under another loopback name is the same site.
		admin.origin = strings.Replace(e.url, "127.0.0.1", "localhost", 1)
		must(t, admin.post("/api/teams", map[string]string{"name": "T2"}), 201)
		admin.origin = e.url
		big := `{"name":"` + strings.Repeat("x", 70<<10) + `"}`
		if r := admin.post("/api/teams", big); r.status != 413 || r.code() != "payload_too_large" {
			t.Fatalf("big body: %d %s", r.status, r.body)
		}
		if r := admin.post("/api/teams", "not json"); r.status != 400 || r.code() != "invalid_request" {
			t.Fatalf("not JSON: %d %s", r.status, r.body)
		}
		if r := do(t, http.DefaultClient, "GET", e.url+"/api/nope", nil, nil); r.status != 404 || r.code() != "not_found" {
			t.Fatalf("unknown route: %d %s", r.status, r.body)
		}
		if r := do(t, http.DefaultClient, "GET", e.url+"/api/configs", nil, nil); r.status != 401 || r.code() != "unauthorized" {
			t.Fatalf("anonymous: %d %s", r.status, r.body)
		}
	})
}
