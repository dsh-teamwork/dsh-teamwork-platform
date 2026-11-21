package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
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

		// Its owner lists and reads it; a teammate neither lists, reads, views
		// nor adds to it, and the team's admin sees it without its content.
		mine := must(t, a.get(base), 200)["pages"].([]any)
		if len(mine) != 1 || mine[0].(map[string]any)["sharing"] != "private" {
			t.Fatalf("mine %v", mine)
		}
		for who, c := range map[string]*browser{"teammate": b, "admin": admin} {
			if got := must(t, c.get(base), 200)["pages"].([]any); len(got) != 0 {
				t.Fatalf("%s lists %v", who, got)
			}
			refused(t, who+" views", c.post(base+"/"+id+"/versions/1/view", nil), 404, "page_not_found")
		}
		refused(t, "teammate reads", b.get(base+"/"+id), 404, "page_not_found")
		if gov := must(t, admin.get(base+"/"+id), 200); gov["access"] != "admin" || len(gov["versions"].([]any)) != 0 {
			t.Fatalf("admin's view %v", gov)
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
		// A page may save a file it makes (a deck's PowerPoint export), and nothing more: never its viewer's origin, the
		// top window or a popup outside the sandbox.
		sandbox := strings.Split(strings.Split(h.Get("Content-Security-Policy"), ";")[0], " ")
		if !slices.Contains(sandbox, "allow-downloads") || slices.ContainsFunc(sandbox, func(f string) bool {
			return f == "allow-same-origin" || strings.HasPrefix(f, "allow-top-navigation") || f == "allow-popups-to-escape-sandbox"
		}) {
			t.Fatalf("sandbox flags: %v", sandbox)
		}
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
		// An edition that serves every subdomain of the content host's domain
		// (as the hosted one serves cloud computers) still never gets it.
		edition := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
		e := start(t, d, options{contentURL: "http://" + content, subdomains: map[string]http.Handler{"test": edition}})
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
		if res, _ := fetch(t, e.url+"/", "computer.test", nil); res.StatusCode != http.StatusTeapot {
			t.Fatalf("the edition's other subdomains: %d", res.StatusCode)
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

// joined is a person who joined the team, with their id.
func joined(t *testing.T, e *env, admin *browser, teamID, email string) (*browser, string) {
	t.Helper()
	b, id := e.person(email)
	_, token := invite(t, admin, teamID)
	must(t, b.post("/api/invites/redeem", map[string]string{"token": token}), 200)
	return b, id
}

func listed(t *testing.T, b *browser, path string) []string {
	t.Helper()
	var ids []string
	for _, p := range must(t, b.get(path), 200)["pages"].([]any) {
		ids = append(ids, p.(map[string]any)["id"].(string))
	}
	return ids
}

func TestPageSharingAdmitsOnlyWhomItNames(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		store := artifactstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{artifacts: store})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		a, _ := joined(t, e, admin, teamID, "a@x.io")
		b, bID := joined(t, e, admin, teamID, "b@x.io")
		c, cID := joined(t, e, admin, teamID, "c@x.io")
		_, outsiderID := e.person("out@x.io")
		pa, pb := e.pluginFor(a), e.pluginFor(b)
		base := "/api/teams/" + teamID + "/pages"
		shared := map[string]string{"index.html": "<h1>v1</h1>", "logo.svg": "<svg/>"}
		id := must(t, publish(t, pa, base, map[string]any{"title": "Plan", "kind": "html"}, shared), 201)["id"].(string)
		page := base + "/" + id
		share := func(who *browser, mode string, members ...string) response {
			body := map[string]any{"mode": mode}
			if members != nil {
				body["members"] = members
			}
			return who.send("PUT", page+"/sharing", body)
		}
		reads := func(who *browser) bool {
			r := who.get(page)
			return r.status == 200 && len(r.json(t)["versions"].([]any)) > 0
		}

		// Chosen members read it and add to it; nobody else does.
		must(t, share(a, "members", bID), 204)
		if !reads(b) || reads(c) {
			t.Fatal("members: b should read and c should not")
		}
		if got := listed(t, b, base+"?list=shared"); len(got) != 1 || got[0] != id {
			t.Fatalf("b's shared %v", got)
		}
		if via := must(t, b.get(base+"?list=shared"), 200)["pages"].([]any)[0].(map[string]any)["via"]; via != "you" {
			t.Fatalf("via %v", via)
		}
		refused(t, "c views", c.post(page+"/versions/1/view", nil), 404, "page_not_found")
		must(t, publish(t, pb, page+"/versions", map[string]any{"kind": "html", "baseVersion": 1}, map[string]string{"index.html": "<h1>v2</h1>", "logo.svg": "<svg/>"}), 201)

		// The team's admin governs it without reading it.
		gov := must(t, admin.get(page), 200)
		if gov["access"] != "admin" || len(gov["versions"].([]any)) != 0 || len(gov["members"].([]any)) != 1 {
			t.Fatalf("admin's view %v", gov)
		}
		refused(t, "admin views", admin.post(page+"/versions/1/view", nil), 404, "page_not_found")
		if got := listed(t, admin, base+"?list=all"); len(got) != 1 {
			t.Fatalf("all %v", got)
		}
		refused(t, "a member lists all", b.get(base+"?list=all"), 403, "admin_required")
		refused(t, "admin widens to the team", share(admin, "team"), 403, "page_sharing_widened")
		refused(t, "admin adds a member", share(admin, "members", bID, cID), 403, "page_sharing_widened")

		// Only the owner widens, renames and restores; a reader cannot, and
		// someone it does not admit learns nothing.
		refused(t, "a reader shares", share(b, "team"), 403, "page_not_owner")
		refused(t, "a reader renames", b.send("PATCH", page, map[string]string{"title": "Mine now"}), 403, "page_not_owner")
		refused(t, "a reader restores", b.post(page+"/versions/1/restore", nil), 403, "page_not_owner")
		refused(t, "a reader deletes", b.send("DELETE", page, nil), 403, "page_not_owner")
		refused(t, "an outsider shares", share(c, "team"), 404, "page_not_found")
		refused(t, "someone outside the team", share(a, "members", outsiderID), 400, "page_member_not_in_team")
		refused(t, "the owner as a member", share(a, "members", bID, mustID(t, a)), 400, "invalid_request")

		// Everyone in the team, then a narrower list that starts afresh.
		must(t, share(a, "team"), 204)
		if !reads(c) {
			t.Fatal("team: c should read")
		}
		if via := must(t, c.get(base+"?list=shared"), 200)["pages"].([]any)[0].(map[string]any)["via"]; via != "team" {
			t.Fatalf("via %v", via)
		}
		must(t, share(admin, "members", cID), 204) // narrowing from the team is an admin's to do
		if reads(b) || !reads(c) {
			t.Fatal("narrowed to c: b should not read")
		}
		must(t, share(admin, "private"), 204)
		refused(t, "admin widens from private", share(admin, "members", cID), 403, "page_sharing_widened")
		must(t, share(a, "team"), 204)
		must(t, share(a, "private"), 204)
		if n := len(must(t, a.get(page), 200)["members"].([]any)); n != 0 {
			t.Fatalf("private keeps %d members", n)
		}

		// The owner renames and restores; a restored version is the old files.
		must(t, a.send("PATCH", page, map[string]string{"title": "Plan B"}), 204)
		restored := must(t, a.post(page+"/versions/1/restore", nil), 201)
		if restored["version"].(float64) != 3 || restored["title"] != "Plan B" {
			t.Fatalf("restored %v", restored)
		}
		address := must(t, a.post(page+"/versions/3/view", nil), 200)["url"].(string)
		if _, body := fetch(t, address, "", nil); body != "<h1>v1</h1>" {
			t.Fatalf("restored page %q", body)
		}

		// Deleting keeps a file another page still names.
		other := must(t, publish(t, pa, base, map[string]any{"title": "Other", "kind": "svg"}, map[string]string{"index.svg": "<svg/>"}), 201)["id"].(string)
		must(t, admin.send("DELETE", page, nil), 204)
		refused(t, "a deleted page", a.get(page), 404, "page_not_found")
		objects, _ := filepath.Glob(filepath.Join(store.Dir, "teams", teamID, "pages", "*"))
		if len(objects) != 1 {
			t.Fatalf("%d objects left, want the one page %s still names", len(objects), other)
		}
	})
}

// mustID is a signed-in person's own id.
func mustID(t *testing.T, b *browser) string {
	t.Helper()
	return must(t, b.get("/api/profile"), 200)["id"].(string)
}

func TestTeamDSHOpensAPageForItsStarter(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pages")
		a, aID := joined(t, e, admin, teamID, "a@x.io")
		_, bID := joined(t, e, admin, teamID, "b@x.io")
		base := "/api/teams/" + teamID + "/pages"
		id := must(t, publish(t, e.pluginFor(a), base, map[string]any{"title": "T", "kind": "svg"}, map[string]string{"index.svg": "<svg/>"}), 201)["id"].(string)
		token, _, _ := auth.NewSealer(secret, nil).Seal(auth.HostBearer, auth.Claims{Sub: "host-1", Via: "host", Team: teamID}, time.Hour)
		host := &plugin{e: e, token: token}
		view := base + "/" + id + "/versions/1/view"
		must(t, host.post(view+"?starter="+aID, nil), 200)
		refused(t, "a starter who may not read it", host.post(view+"?starter="+bID, nil), 404, "page_not_found")
		refused(t, "no starter", host.post(view, nil), 404, "page_not_found")
	})
}

// A deleted account takes its private pages and its own team's pages with it;
// the pages it shared stay with their team, and lists that named it forget it.
func TestDeletingAnAccountDeletesWhatOnlyItCouldRead(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		store := artifactstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{artifacts: store})
		admin := e.admin("admin@x.io")
		shared := newTeam(t, admin, "Shared")
		leaver, leaverID := joined(t, e, admin, shared, "leaver@x.io")
		_, otherID := joined(t, e, admin, shared, "other@x.io")
		own := newTeam(t, leaver, "Own")
		p := e.pluginFor(leaver)
		svg := func(s string) map[string]string { return map[string]string{"index.svg": "<svg>" + s + "</svg>"} }
		private := must(t, publish(t, p, "/api/teams/"+shared+"/pages", map[string]any{"title": "Private", "kind": "svg"}, svg("private")), 201)["id"].(string)
		team := must(t, publish(t, p, "/api/teams/"+shared+"/pages", map[string]any{"title": "Team", "kind": "svg"}, svg("team")), 201)["id"].(string)
		must(t, leaver.send("PUT", "/api/teams/"+shared+"/pages/"+team+"/sharing", map[string]any{"mode": "team"}), 204)
		named := must(t, publish(t, e.pluginFor(admin), "/api/teams/"+shared+"/pages", map[string]any{"title": "Named", "kind": "svg"}, svg("named")), 201)["id"].(string)
		must(t, admin.send("PUT", "/api/teams/"+shared+"/pages/"+named+"/sharing", map[string]any{"mode": "members", "members": []string{leaverID, otherID}}), 204)
		must(t, publish(t, p, "/api/teams/"+own+"/pages", map[string]any{"title": "Mine alone", "kind": "svg"}, svg("own")), 201)

		must(t, leaver.send("DELETE", "/api/profile", map[string]string{"confirm": "leaver@x.io"}), 204)

		left := d.Client.Page.Query().IDsX(ctx)
		if len(left) != 2 || !slices.Contains(left, team) || !slices.Contains(left, named) || slices.Contains(left, private) {
			t.Fatalf("pages left %v, want the shared one and the admin's", left)
		}
		if n := d.Client.PageMember.Query().CountX(ctx); n != 1 {
			t.Fatalf("%d members named, want only the other member", n)
		}
		for teamID, want := range map[string]int{shared: 2, own: 0} {
			objects, _ := filepath.Glob(filepath.Join(store.Dir, "teams", teamID, "pages", "*"))
			if len(objects) != want {
				t.Fatalf("team %s keeps %d objects, want %d", teamID, len(objects), want)
			}
		}
	})
}
