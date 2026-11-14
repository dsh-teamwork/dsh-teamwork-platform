package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
)

const secret = "test-auth-secret-at-least-32-characters"

// env is one running server over one test database.
type env struct {
	t       *testing.T
	db      *testdb.DB
	url     string
	network *team.Network
}

type options struct {
	allowPrivate bool
	smtp         string
	mailer       auth.Mailer
	lookup       func(ctx context.Context, host string) ([]netip.Addr, error)
	web          fs.FS // a console build to serve, as web.New takes it
}

func start(t *testing.T, d *testdb.DB, o options) *env {
	t.Helper()
	keys, err := team.NewKeys(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	network := &team.Network{AllowPrivate: o.allowPrivate, Lookup: o.lookup}
	authn := &auth.Service{DB: d.Client, Sealer: auth.NewSealer(secret, nil), Secret: secret}
	teams := &team.Service{DB: d.Client, Keys: keys, Network: network, Auth: authn, Passwords: o.smtp == ""}
	ts := httptest.NewUnstartedServer(nil)
	appURL := "http://" + ts.Listener.Addr().String()
	srv := &httpapi.Server{
		Config:  config.Config{AppURL: appURL, AuthSecret: secret, SMTPURL: o.smtp},
		Auth:    authn,
		Team:    teams,
		Gateway: &gateway.Gateway{Team: teams, Client: network.Client()},
	}
	srv.Mailer = o.mailer
	if o.web != nil {
		srv.Web = web.New(o.web, web.Options{AppURL: appURL, Viewer: srv.Viewer})
	}
	ts.Config.Handler = srv.Handler()
	ts.Start()
	t.Cleanup(ts.Close)
	holdToContract(t, appURL)
	return &env{t: t, db: d, url: appURL, network: network}
}

// browser is a person's browser: a cookie jar, and the site's own Origin.
type browser struct {
	e      *env
	client *http.Client
	origin string
}

func (e *env) browser() *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{e: e, client: &http.Client{Jar: jar}, origin: e.url}
}

type response struct {
	status int
	body   []byte
}

func (r response) json(t *testing.T) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(r.body, &v); err != nil {
		t.Fatalf("not JSON (%d): %s", r.status, r.body)
	}
	return v
}

func (r response) code() string {
	var v struct{ Error string }
	json.Unmarshal(r.body, &v)
	return v.Error
}

func do(t *testing.T, c *http.Client, method, url string, body any, header map[string]string) response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		if s, ok := body.(string); ok {
			reader = strings.NewReader(s)
		} else {
			b, _ := json.Marshal(body)
			reader = bytes.NewReader(b)
		}
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	checkContract(t, req, res, b)
	return response{status: res.StatusCode, body: b}
}

func (b *browser) post(path string, body any) response {
	return do(b.e.t, b.client, "POST", b.e.url+path, body, map[string]string{"Origin": b.origin})
}

func (b *browser) get(path string) response {
	return do(b.e.t, b.client, "GET", b.e.url+path, nil, nil)
}

// plugin is the DSH plugin with its Bearer token.
type plugin struct {
	e     *env
	token string
}

func (p *plugin) post(path string, body any) response {
	return do(p.e.t, http.DefaultClient, "POST", p.e.url+path, body, map[string]string{"Authorization": "Bearer " + p.token})
}

func (p *plugin) get(path string) response {
	return do(p.e.t, http.DefaultClient, "GET", p.e.url+path, nil, map[string]string{"Authorization": "Bearer " + p.token})
}

func must(t *testing.T, r response, status int) map[string]any {
	t.Helper()
	if r.status != status {
		t.Fatalf("status %d, want %d: %s", r.status, status, r.body)
	}
	if len(r.body) == 0 {
		return nil
	}
	return r.json(t)
}

// admin claims the first account and signs in with it.
func (e *env) admin(email string) *browser {
	b := e.browser()
	r := b.post("/api/auth/setup", map[string]string{"token": auth.SetupToken(secret), "email": email, "password": "correct horse battery"})
	if r.status != http.StatusNoContent {
		e.t.Fatalf("setup: %d %s", r.status, r.body)
	}
	return b
}

// pluginFor walks the PKCE hand-off for the browser's person.
func (e *env) pluginFor(b *browser) *plugin {
	verifier := strings.Repeat("v", 43)
	code := must(e.t, b.post("/api/auth/plugin/code", map[string]string{"challenge": auth.ChallengeOf(verifier)}), 200)["code"].(string)
	tok := must(e.t, do(e.t, http.DefaultClient, "POST", e.url+"/api/auth/plugin/token", map[string]string{"code": code, "verifier": verifier}, nil), 200)
	return &plugin{e: e, token: tok["token"].(string)}
}

// stub is a provider: JSON, or a stream of chunks, the last body it got, and
// how many connections reached it at all.
type stub struct {
	*httptest.Server
	mu    sync.Mutex
	last  []byte
	hits  int
	conns atomic.Int32
}

// counting counts the connections a listener accepts.
type counting struct {
	net.Listener
	n *atomic.Int32
}

func (c counting) Accept() (net.Conn, error) {
	conn, err := c.Listener.Accept()
	if err == nil {
		c.n.Add(1)
	}
	return conn, err
}

func newStub(t *testing.T) *stub {
	s := &stub{}
	s.Server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.last, s.hits = b, s.hits+1
		s.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer sk-test-provider-key" {
			w.WriteHeader(401)
			return
		}
		if bytes.Contains(b, []byte(`"stream":true`)) {
			w.Header().Set("Content-Type", "text/event-stream")
			for i := 0; i < 3; i++ {
				io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n")
				w.(http.Flusher).Flush()
			}
			io.WriteString(w, "data: [DONE]\n\n")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "upstream=secret")
		io.WriteString(w, `{"choices":[{"message":{"content":"hello"}}]}`)
	}))
	s.Listener = counting{Listener: s.Listener, n: &s.conns}
	s.Start()
	t.Cleanup(s.Close)
	return s
}

// team sets a team up: the team, the stub as provider "stub", and a model.
func (e *env) team(b *browser, s *stub, name string) (teamID, modelID string) {
	teamID = must(e.t, b.post("/api/teams", map[string]string{"name": name}), 201)["id"].(string)
	must(e.t, b.post("/api/teams/"+teamID+"/providers", map[string]string{"name": "stub", "baseUrl": s.URL, "apiKey": "sk-test-provider-key"}), 201)
	modelID = must(e.t, b.post("/api/teams/"+teamID+"/configs", map[string]any{
		"kind": "model", "name": "Stub", "data": map[string]any{"provider": "stub", "model": "stub-model", "maxTokens": 4096},
	}), 201)["id"].(string)
	return teamID, modelID
}
