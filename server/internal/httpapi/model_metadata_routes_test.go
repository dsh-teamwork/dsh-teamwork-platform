package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

type lookupTransport func(*http.Request) (*http.Response, error)

func (f lookupTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMetadataLookupIsAdminOnlyTransientAndIndependent(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		var calls atomic.Int32
		client := &http.Client{Transport: lookupTransport(func(r *http.Request) (*http.Response, error) {
			calls.Add(1)
			if r.URL.String() != "https://openrouter.ai/api/v1/models" || r.Header.Get("Authorization") != "" {
				t.Errorf("unexpected public request: %v", r)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[{"id":"lab/reference","name":"Reference","context_length":128000,"architecture":{"input_modalities":["text","image"]},"top_provider":{"max_completion_tokens":4096},"pricing":{"prompt":"0.000002"}}]}`)), Header: make(http.Header)}, nil
		})}
		e := start(t, d, options{gatewayClient: client})
		admin := e.admin("admin@metadata.test")
		member, _ := e.person("member@metadata.test")
		outsider, _ := e.person("outside@metadata.test")
		teamID := newTeam(t, admin, "Metadata")
		_, token := invite(t, admin, teamID)
		must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		path := "/api/teams/" + teamID + "/model-metadata/lookup"
		body := map[string]any{"source": "openrouter", "provider": "", "query": "reference"}
		refused(t, "member lookup", member.post(path, body), 403, "admin_required")
		refused(t, "outside lookup", outsider.post(path, body), 404, "team_not_found")
		if calls.Load() != 0 {
			t.Fatal("upstream queried before authorization")
		}
		before := d.Client.TeamConfig.Query().CountX(context.Background())
		for range 2 {
			must(t, admin.post(path, body), 200)
		}
		if calls.Load() != 2 || d.Client.TeamConfig.Query().CountX(context.Background()) != before || d.Client.ModelRate.Query().CountX(context.Background()) != 0 {
			t.Fatal("lookup cached or persisted")
		}
		bad := map[string]any{"source": "https://attacker.invalid", "provider": "", "query": "reference"}
		if res := admin.post(path, bad); res.status != 400 {
			t.Fatal("arbitrary source accepted", res.status)
		}
		addProvider(t, admin, teamID)
		config := model("Independent")
		config["data"] = map[string]any{"provider": "deepseek", "model": "custom-alias", "contextWindow": 128000, "maxTokens": 4096, "vision": true}
		saved := must(t, admin.post("/api/teams/"+teamID+"/configs", config), 201)
		data := saved["data"].(map[string]any)
		if data["model"] != "custom-alias" || data["vision"] != true || len(data) != 5 {
			t.Fatalf("configuration linked or changed: %+v", data)
		}
		snapshot := must(t, admin.get("/api/configs"), 200)
		raw, _ := json.Marshal(snapshot)
		if !strings.Contains(string(raw), `"vision":true`) || !strings.Contains(string(raw), `"model":"custom-alias"`) {
			t.Fatalf("vision not delivered: %s", raw)
		}

	})
}
