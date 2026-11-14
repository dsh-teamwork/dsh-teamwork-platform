package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// upstream is a provider whose answer each test chooses, recording the
// requests that reached it.
type upstream struct {
	*httptest.Server
	mu     sync.Mutex
	auths  []string
	bodies [][]byte
	paths  []string
}

func newUpstream(t *testing.T, h http.HandlerFunc) *upstream {
	u := &upstream{}
	u.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.auths, u.bodies, u.paths = append(u.auths, r.Header.Get("Authorization")), append(u.bodies, b), append(u.paths, r.Method+" "+r.URL.Path)
		u.mu.Unlock()
		h(w, r)
	}))
	t.Cleanup(u.Close)
	return u
}

func (u *upstream) hits() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.auths)
}

func answerJSON(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, body)
}

// stubTeam is a team whose provider "stub" is u, called with key, and a
// model calling it.
func stubTeam(t *testing.T, b *browser, u *upstream, key string) (teamID, modelID string) {
	t.Helper()
	teamID = newTeam(t, b, "Team")
	must(t, b.post("/api/teams/"+teamID+"/providers", map[string]string{"name": "stub", "baseUrl": u.URL, "apiKey": key}), 201)
	modelID = must(t, b.post("/api/teams/"+teamID+"/configs", map[string]any{
		"kind": "model", "name": "Stub", "data": map[string]any{"provider": "stub", "model": "stub-model"},
	}), 201)["id"].(string)
	return teamID, modelID
}

func call(p *plugin, model string, stream bool) response {
	return p.post("/api/llm/chat/completions", map[string]any{"model": model, "stream": stream, "messages": []any{map[string]string{"role": "user", "content": "hi"}}})
}

// An upstream failure is answered with a code, never with its body.
func TestGatewayUpstreamFailures(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		var mode string
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			switch mode {
			case "500":
				w.WriteHeader(500)
				io.WriteString(w, "upstream-secret-detail")
			case "429":
				w.Header().Set("Retry-After", "30")
				w.WriteHeader(429)
				io.WriteString(w, "upstream-secret-detail")
			case "json":
				answerJSON(w, `{"detail":"upstream-secret-detail"}`)
			}
		})
		admin := e.admin("a@x.io")
		_, modelID := stubTeam(t, admin, u, "sk-key")
		p := e.pluginFor(admin)

		mode = "500"
		r := call(p, modelID, false)
		refused(t, "an upstream 500", r, 502, "upstream_unavailable")
		if strings.Contains(string(r.body), "upstream-secret-detail") {
			t.Fatalf("the upstream body reached the caller: %s", r.body)
		}
		mode = "429"
		r = call(p, modelID, false)
		refused(t, "an upstream 429", r, 429, "upstream_rate_limited")
		if strings.Contains(string(r.body), "upstream-secret-detail") {
			t.Fatalf("the upstream body reached the caller: %s", r.body)
		}
		mode = "json"
		r = call(p, modelID, true)
		refused(t, "a JSON answer to a stream request", r, 502, "upstream_unavailable")
		if strings.Contains(string(r.body), "upstream-secret-detail") {
			t.Fatalf("the upstream body reached the caller: %s", r.body)
		}
		if u.hits() != 3 {
			t.Fatalf("%d calls reached upstream", u.hits())
		}
	})
}

// A preset follows its modelConfigId to a model of its own team, and never
// to another team's.
func TestGatewayPresetResolvesWithinItsTeam(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"choices":[]}`) })
		admin := e.admin("a@x.io")
		teamA, modelA := stubTeam(t, admin, u, "sk-a")
		presetA := must(t, admin.post("/api/teams/"+teamA+"/configs", map[string]any{"kind": "preset", "name": "Review", "data": map[string]any{"modelConfigId": modelA}}), 201)["id"].(string)

		must(t, call(e.pluginFor(admin), presetA, false), 200)
		if u.hits() != 1 || !strings.Contains(string(u.bodies[0]), `"model":"stub-model"`) {
			t.Fatalf("upstream got %q", u.bodies)
		}

		other, _ := e.person("b@x.io")
		teamB, modelB := stubTeam(t, other, u, "sk-b")
		refused(t, "a preset naming another team's model", other.post("/api/teams/"+teamB+"/configs", map[string]any{"kind": "preset", "name": "Borrow", "data": map[string]any{"modelConfigId": modelA}}), 400, "model_not_found")

		// A preset row that names another team's model all the same (written
		// past the API) resolves to nothing, and nothing is called.
		presetB := must(t, other.post("/api/teams/"+teamB+"/configs", map[string]any{"kind": "preset", "name": "Own", "data": map[string]any{"modelConfigId": modelB}}), 201)["id"].(string)
		data, _ := json.Marshal(map[string]any{"modelConfigId": modelA})
		d.Client.TeamConfig.Update().Where(teamconfig.ID(presetB)).SetData(data).ExecX(context.Background())
		before := u.hits()
		refused(t, "a preset resolving into another team", call(e.pluginFor(other), presetB, false), 403, "model_forbidden")
		if u.hits() != before {
			t.Fatal("upstream was called for a preset resolving into another team")
		}
	})
}

// Two teams each with a provider named "stub": each call reaches only its
// own team's address, with the key sealed for that team.
func TestGatewayCallsOnlyTheTeamsOwnProvider(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		ok := func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"choices":[]}`) }
		ua, ub := newUpstream(t, ok), newUpstream(t, ok)
		a := e.admin("a@x.io")
		b, _ := e.person("b@x.io")
		_, modelA := stubTeam(t, a, ua, "sk-team-a")
		_, modelB := stubTeam(t, b, ub, "sk-team-b")

		must(t, call(e.pluginFor(a), modelA, false), 200)
		if ua.hits() != 1 || ub.hits() != 0 || ua.auths[0] != "Bearer sk-team-a" {
			t.Fatalf("team A's call: A got %v, B got %v", ua.auths, ub.auths)
		}
		must(t, call(e.pluginFor(b), modelB, false), 200)
		if ua.hits() != 1 || ub.hits() != 1 || ub.auths[0] != "Bearer sk-team-b" {
			t.Fatalf("team B's call: A got %v, B got %v", ua.auths, ub.auths)
		}
	})
}

// The address rule as a provider is saved, by what its host resolves to.
func TestProviderAddressRuleByResolution(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		lookup := func(ctx context.Context, host string) ([]netip.Addr, error) {
			switch host {
			case "public.example":
				return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
			case "private.example":
				return []netip.Addr{netip.MustParseAddr("10.0.0.1")}, nil
			case "mixed.example":
				return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("10.0.0.1")}, nil
			}
			return nil, errors.New("no such host")
		}
		save := func(e *env, b *browser, teamID, url string) response {
			return b.post("/api/teams/"+teamID+"/providers", map[string]string{"name": "p" + url[len(url)-8:], "baseUrl": url, "apiKey": "k"})
		}

		strict := start(t, d, options{lookup: lookup})
		sa := strict.admin("a@x.io")
		st := newTeam(t, sa, "Strict")
		must(t, save(strict, sa, st, "https://public.example/v1"), 201)
		for _, url := range []string{"http://127.0.0.1/v1", "http://public.example/v1", "https://private.example/v1", "https://mixed.example/v1", "https://nowhere.example/v1"} {
			refused(t, "strict "+url, save(strict, sa, st, url), 400, "provider_address_refused")
		}

		open := start(t, testdb.New(t, d.Name), options{allowPrivate: true, lookup: lookup})
		oa := open.admin("a@x.io")
		ot := newTeam(t, oa, "Open")
		must(t, save(open, oa, ot, "http://private.example/v1"), 201)
		for _, url := range []string{"http://public.example/v1", "http://mixed.example/v1", "https://nowhere.example/v1"} {
			refused(t, "open "+url, save(open, oa, ot, url), 400, "provider_address_refused")
		}
	})
}

func TestModelCatalog(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		var answer func(w http.ResponseWriter)
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "GET" || r.URL.Path != "/models" {
				w.WriteHeader(404)
				return
			}
			answer(w)
		})
		admin := e.admin("a@x.io")
		teamID, _ := stubTeam(t, admin, u, "sk-catalog")
		catalog := "/api/teams/" + teamID + "/model-catalog"

		t.Run("reports only the limits the provider states", func(t *testing.T) {
			answer = func(w http.ResponseWriter) {
				answerJSON(w, `{"object":"list","data":[
					{"id":"kimi","display_name":"Kimi","context_length":1048576,"apiKey":"secret-key","owned_by":"someone","pricing":{"prompt":"1"}},
					{"id":"other","limit":{"context":128000,"output":8192}},
					{"id":"third","context_window":32000,"max_completion_tokens":4000},
					{"id":"fourth","max_output_tokens":100}
				]}`)
			}
			r := admin.get(catalog + "?provider=stub")
			var got struct {
				Provider string           `json:"provider"`
				Models   []map[string]any `json:"models"`
			}
			if r.status != 200 || json.Unmarshal(r.body, &got) != nil {
				t.Fatalf("catalog: %d %s", r.status, r.body)
			}
			want := []map[string]any{
				{"id": "kimi", "name": "Kimi", "contextWindow": float64(1048576)},
				{"id": "other", "name": "other", "contextWindow": float64(128000), "maxTokens": float64(8192)},
				{"id": "third", "name": "third", "contextWindow": float64(32000), "maxTokens": float64(4000)},
				{"id": "fourth", "name": "fourth", "maxTokens": float64(100)},
			}
			wb, _ := json.Marshal(want)
			gb, _ := json.Marshal(got.Models)
			if got.Provider != "stub" || string(wb) != string(gb) {
				t.Fatalf("catalog %s\nwant %s", r.body, wb)
			}
			for _, leak := range []string{"secret-key", "owned_by", "someone", "pricing", "sk-catalog"} {
				if strings.Contains(string(r.body), leak) {
					t.Fatalf("%q reached the answer: %s", leak, r.body)
				}
			}
			if u.auths[len(u.auths)-1] != "Bearer sk-catalog" {
				t.Fatalf("upstream auth: %v", u.auths)
			}
		})

		t.Run("is for admins only", func(t *testing.T) {
			member, _ := e.person("m@x.io")
			_, token := invite(t, admin, teamID)
			must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
			before := u.hits()
			refused(t, "a member", member.get(catalog+"?provider=stub"), 403, "admin_required")
			if u.hits() != before {
				t.Fatal("a member's request reached the provider")
			}
		})

		t.Run("answers an upstream error, a malformed list or an oversized one with one code", func(t *testing.T) {
			for what, a := range map[string]func(w http.ResponseWriter){
				"an upstream 401": func(w http.ResponseWriter) { w.WriteHeader(401); io.WriteString(w, "secret-key") },
				"a negative limit": func(w http.ResponseWriter) {
					answerJSON(w, `{"data":[{"id":"bad","context_length":-1}]}`)
				},
				"no list":  func(w http.ResponseWriter) { answerJSON(w, `{"models":[]}`) },
				"not JSON": func(w http.ResponseWriter) { answerJSON(w, `secret-key`) },
				"over a megabyte": func(w http.ResponseWriter) {
					answerJSON(w, `{"data":[{"id":"x","display_name":"`+strings.Repeat("x", 1<<20)+`"}]}`)
				},
			} {
				answer = a
				r := admin.get(catalog + "?provider=stub")
				refused(t, what, r, 502, "upstream_unavailable")
				if strings.Contains(string(r.body), "secret-key") {
					t.Fatalf("%s: the upstream body reached the caller: %s", what, r.body)
				}
			}
		})

		t.Run("names a provider", func(t *testing.T) {
			refused(t, "no provider", admin.get(catalog), 400, "invalid_request")
		})
	})
}
