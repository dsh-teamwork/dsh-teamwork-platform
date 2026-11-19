package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifactstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/pages"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// publish is the plugin's upload: a meta part and one part per file.
func publish(t *testing.T, p *plugin, path string, meta map[string]any, files map[string]string) response {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	m, _ := json.Marshal(meta)
	w.WriteField("meta", string(m))
	for name, content := range files {
		part, _ := w.CreateFormFile(name, filepath.Base(name))
		part.Write([]byte(content))
	}
	w.Close()
	return do(t, http.DefaultClient, "POST", p.e.url+path, body.String(), map[string]string{"Authorization": "Bearer " + p.token, "Content-Type": w.FormDataContentType()})
}

// fetch is a browser loading a view address: no cookie, whatever host it names.
func fetch(t *testing.T, address, host string, header map[string]string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest("GET", address, nil)
	if err != nil {
		t.Fatal(err)
	}
	if host != "" {
		req.Host = host
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

const pageHTML = `<!doctype html><link rel="stylesheet" href="style.css"><h1>Q4</h1>`

func TestPagesArePrivateToTheirOwner(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		store := artifactstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{artifacts: store})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		a, _ := e.person("a@x.io")
		b, _ := e.person("b@x.io")
		for _, person := range []*browser{a, b} {
			_, token := invite(t, admin, teamID)
			must(t, person.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		}
		pa, pb := e.pluginFor(a), e.pluginFor(b)
		base := "/api/teams/" + teamID + "/pages"
		files := map[string]string{"index.html": pageHTML, "style.css": "h1{color:red}"}

		created := must(t, publish(t, pa, base, map[string]any{"title": "Q4 usage", "kind": "html", "note": "first", "sessionId": "s-1", "computer": "MacBook"}, files), 201)
		id := created["id"].(string)
		if created["version"].(float64) != 1 {
			t.Fatalf("created %v", created)
		}

		// Its owner lists and reads it; a teammate, the team's admin included,
		// neither lists, reads, views nor adds to it.
		mine := must(t, a.get(base), 200)["pages"].([]any)
		if len(mine) != 1 || mine[0].(map[string]any)["sharing"] != "private" {
			t.Fatalf("mine %v", mine)
		}
		for who, c := range map[string]*browser{"teammate": b, "admin": admin} {
			if got := must(t, c.get(base), 200)["pages"].([]any); len(got) != 0 {
				t.Fatalf("%s lists %v", who, got)
			}
			refused(t, who+" reads", c.get(base+"/"+id), 404, "page_not_found")
			refused(t, who+" views", c.post(base+"/"+id+"/versions/1/view", nil), 404, "page_not_found")
		}
		refused(t, "teammate adds a version", publish(t, pb, base+"/"+id+"/versions", map[string]any{"kind": "html", "baseVersion": 1}, files), 404, "page_not_found")

		// A version goes on top of the current one only.
		files["index.html"] = pageHTML + "<p>v2</p>"
		must(t, publish(t, pa, base+"/"+id+"/versions", map[string]any{"kind": "html", "baseVersion": 1, "note": "second"}, files), 201)
		refused(t, "a stale base", publish(t, pa, base+"/"+id+"/versions", map[string]any{"kind": "html", "baseVersion": 1}, files), 409, "page_stale")
		detail := must(t, a.get(base+"/"+id), 200)
		versions := detail["versions"].([]any)
		if detail["currentVersion"].(float64) != 2 || len(versions) != 2 || versions[0].(map[string]any)["note"] != "second" {
			t.Fatalf("detail %v", detail)
		}

		// The unchanged stylesheet is stored once.
		objects, _ := filepath.Glob(filepath.Join(store.Dir, "teams", teamID, "pages", "*"))
		if len(objects) != 3 {
			t.Fatalf("%d objects, want 3 (two pages and one stylesheet)", len(objects))
		}

		// Version 1 is served as it was, sandboxed, from its view address.
		view := must(t, a.post(base+"/"+id+"/versions/1/view", nil), 200)
		address := view["url"].(string)
		res, body := fetch(t, address, "", map[string]string{"Cookie": "dsh-teamwork.session=whatever"})
		if res.StatusCode != 200 || body != pageHTML {
			t.Fatalf("view: %d %q", res.StatusCode, body)
		}
		h := res.Header
		if csp := h.Get("Content-Security-Policy"); !strings.HasPrefix(csp, "sandbox allow-scripts") || strings.Contains(csp, "allow-same-origin") || !strings.Contains(csp, "frame-ancestors "+e.url) {
			t.Fatalf("CSP %q", csp)
		}
		if h.Get("X-Frame-Options") != "" || h.Get("Set-Cookie") != "" || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Cache-Control") != "private, no-cache" {
			t.Fatalf("headers %v", h)
		}
		if res, body := fetch(t, address+"style.css", "", nil); res.StatusCode != 200 || body != "h1{color:red}" || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/css") {
			t.Fatalf("stylesheet: %d %q", res.StatusCode, body)
		}
		if res, _ := fetch(t, address, "", map[string]string{"If-None-Match": h.Get("ETag")}); res.StatusCode != 304 {
			t.Fatalf("revalidation: %d", res.StatusCode)
		}
		for _, bad := range []string{address + "missing.css", address + "..%2Fsecret", strings.TrimSuffix(address, "/") + "x/"} {
			if res, _ := fetch(t, bad, "", nil); res.StatusCode != 404 {
				t.Fatalf("%s: %d", bad, res.StatusCode)
			}
		}
		if res, _ := fetch(t, strings.TrimSuffix(address, "/"), "", nil); res.StatusCode != 302 {
			t.Fatalf("no trailing slash: %d", res.StatusCode)
		}

		// A view address dies with its hour, and with its reader's membership.
		u, _ := url.Parse(address)
		token := strings.Split(strings.TrimPrefix(u.Path, "/p/"), "/")[0]
		claims, err := auth.NewSealer(secret, nil).Open(auth.PageView, token)
		if err != nil {
			t.Fatal(err)
		}
		old, _, _ := auth.NewSealer(secret, func() time.Time { return time.Now().Add(-2 * time.Hour) }).Seal(auth.PageView, claims, auth.PageViewTTL)
		if res, _ := fetch(t, e.url+"/p/"+old+"/", "", nil); res.StatusCode != 404 {
			t.Fatalf("expired address: %d", res.StatusCode)
		}
		other := newTeam(t, a, "Elsewhere")
		claims.Team = other
		moved, _, _ := auth.NewSealer(secret, nil).Seal(auth.PageView, claims, auth.PageViewTTL)
		if res, _ := fetch(t, e.url+"/p/"+moved+"/", "", nil); res.StatusCode != 404 {
			t.Fatalf("another team's id: %d", res.StatusCode)
		}
		var aID string
		for _, m := range must(t, admin.get("/api/teams/"+teamID), 200)["members"].([]any) {
			if m.(map[string]any)["email"] == "a@x.io" {
				aID = m.(map[string]any)["userId"].(string)
			}
		}
		must(t, admin.send("DELETE", "/api/teams/"+teamID+"/members/"+aID, nil), 204)
		if res, _ := fetch(t, address, "", nil); res.StatusCode != 404 {
			t.Fatalf("after leaving the team: %d", res.StatusCode)
		}
	})
}

func TestPageUploadsAreRefusedBeforeStoring(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		store := artifactstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{artifacts: store})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		p := e.pluginFor(admin)
		base := "/api/teams/" + teamID + "/pages"
		html := map[string]any{"title": "T", "kind": "html"}
		for what, c := range map[string]struct {
			meta  map[string]any
			files map[string]string
		}{
			"a path out of the page":   {html, map[string]string{"index.html": "x", "../x.css": "y"}},
			"a hidden file":            {html, map[string]string{"index.html": "x", ".env": "y"}},
			"a type a page never uses": {html, map[string]string{"index.html": "x", "run.exe": "y"}},
			"no entry":                 {html, map[string]string{"main.html": "x"}},
			"markdown with more":       {map[string]any{"title": "T", "kind": "markdown"}, map[string]string{"index.md": "# x", "a.png": "y"}},
			"no title":                 {map[string]any{"kind": "svg"}, map[string]string{"index.svg": "<svg/>"}},
			"an unknown kind":          {map[string]any{"title": "T", "kind": "pdf"}, map[string]string{"index.html": "x"}},
		} {
			refused(t, what, publish(t, p, base, c.meta, c.files), 400, "invalid_request")
		}
		defer func(q int64) { pages.TeamQuota = q }(pages.TeamQuota)
		pages.TeamQuota = 10
		refused(t, "past the team's quota", publish(t, p, base, map[string]any{"title": "T", "kind": "svg"}, map[string]string{"index.svg": "<svg>too much</svg>"}), 413, "page_team_full")
		pages.TeamQuota = 1 << 30
		refused(t, "a file over 5 MiB", publish(t, p, base, html, map[string]string{"index.html": strings.Repeat("x", 5<<20+1)}), 413, "page_too_large")
		if entries, _ := os.ReadDir(filepath.Join(store.Dir, "teams")); len(entries) != 0 {
			t.Fatalf("refused uploads stored %d team directories", len(entries))
		}
		// The browser's session publishes nothing: pages come from a DSH.
		refused(t, "a session uploads", admin.post(base, "x"), 400, "invalid_request")
	})
}

func TestMarkdownPagesAreRendered(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		base := "/api/teams/" + teamID + "/pages"
		id := must(t, publish(t, e.pluginFor(admin), base, map[string]any{"title": "Notes", "kind": "markdown"}, map[string]string{"index.md": "# Hello\n\n<script>alert(1)</script>\n\n| a |\n|---|\n| 1 |"}), 201)["id"].(string)
		address := must(t, admin.post(base+"/"+id+"/versions/1/view", nil), 200)["url"].(string)
		res, body := fetch(t, address, "", nil)
		if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") || !strings.Contains(body, "<h1>Hello</h1>") || !strings.Contains(body, "<table>") || strings.Contains(body, "<script>alert") {
			t.Fatalf("markdown: %d %s", res.StatusCode, body)
		}
	})
}

func TestPagesHaveAHostOfTheirOwn(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		const content = "pages.test"
		e := start(t, d, options{contentURL: "http://" + content})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		base := "/api/teams/" + teamID + "/pages"
		id := must(t, publish(t, e.pluginFor(admin), base, map[string]any{"title": "T", "kind": "svg"}, map[string]string{"index.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>"}), 201)["id"].(string)
		address := must(t, admin.post(base+"/"+id+"/versions/1/view", nil), 200)["url"].(string)
		if !strings.HasPrefix(address, "http://"+content+"/p/") {
			t.Fatalf("address %s", address)
		}
		path := strings.TrimPrefix(address, "http://"+content)
		if res, body := fetch(t, e.url+path, content, nil); res.StatusCode != 200 || !strings.HasPrefix(body, "<svg") || res.Header.Get("Content-Type") != "image/svg+xml" {
			t.Fatalf("content host: %d %s", res.StatusCode, body)
		}
		if res, _ := fetch(t, e.url+path, "", nil); res.StatusCode != 404 {
			t.Fatalf("the site's own host serves a page: %d", res.StatusCode)
		}
		if res, _ := fetch(t, e.url+"/api/teams", content, nil); res.StatusCode != 404 {
			t.Fatalf("the content host serves the API: %d", res.StatusCode)
		}
		if res, body := fetch(t, e.url+"/robots.txt", content, nil); res.StatusCode != 200 || !strings.Contains(body, "Disallow: /") {
			t.Fatalf("robots: %d %s", res.StatusCode, body)
		}
	})
}

func TestTeamDSHPublishesForItsStarter(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		other := newTeam(t, admin, "Other")
		outsider, outsiderID := e.person("out@x.io")
		_ = outsider
		var adminID string
		for _, m := range must(t, admin.get("/api/teams/"+teamID), 200)["members"].([]any) {
			adminID = m.(map[string]any)["userId"].(string)
		}
		token, _, _ := auth.NewSealer(secret, nil).Seal(auth.HostBearer, auth.Claims{Sub: "host-1", Via: "host", Team: teamID}, time.Hour)
		host := &plugin{e: e, token: token}
		files := map[string]string{"index.svg": "<svg/>"}
		meta := func(starter string) map[string]any {
			return map[string]any{"title": "T", "kind": "svg", "starter": starter}
		}
		refused(t, "no starter", publish(t, host, "/api/teams/"+teamID+"/pages", meta(""), files), 400, "invalid_request")
		refused(t, "a starter outside the team", publish(t, host, "/api/teams/"+teamID+"/pages", meta(outsiderID), files), 400, "invalid_request")
		refused(t, "another team", publish(t, host, "/api/teams/"+other+"/pages", meta(adminID), files), 404, "team_not_found")
		id := must(t, publish(t, host, "/api/teams/"+teamID+"/pages", meta(adminID), files), 201)["id"].(string)
		detail := must(t, admin.get("/api/teams/"+teamID+"/pages/"+id), 200)
		v := detail["versions"].([]any)[0].(map[string]any)
		if detail["owner"].(map[string]any)["id"] != adminID || v["teamDsh"] != true {
			t.Fatalf("detail %v", detail)
		}
		refused(t, "a host token views", host.post("/api/teams/"+teamID+"/pages/"+id+"/versions/1/view", nil), 404, "page_not_found")
	})
}
