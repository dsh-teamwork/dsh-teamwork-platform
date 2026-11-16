package manage_test

// The admin API's tests, ported from the Next console's api-guard, admin,
// admin-api and route suites, against the real server on each database the
// open suites reach (server/edition/editiontest).

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

const key = "test-manage-api-key"

type world struct {
	t  *testing.T
	in *editiontest.Instance
}

type request struct {
	method, path, body string
	header             map[string]string
	cookie             *http.Cookie
}

func (w world) do(r request) (int, map[string]any) {
	w.t.Helper()
	req, _ := http.NewRequest(r.method, w.in.URL+r.path, strings.NewReader(r.body))
	for k, v := range r.header {
		req.Header.Set(k, v)
	}
	if r.cookie != nil {
		req.AddCookie(r.cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		w.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	var out map[string]any
	json.Unmarshal(b, &out)
	if res.Header.Get("Cache-Control") != "no-store" && strings.HasPrefix(r.path, "/api/admin") && res.StatusCode != 404 {
		w.t.Fatalf("%s %s: Cache-Control %q", r.method, r.path, res.Header.Get("Cache-Control"))
	}
	return res.StatusCode, out
}

func each(t *testing.T, env map[string]string, f func(t *testing.T, w world)) {
	editiontest.Each(t, []edition.Extension{}, editiontest.Options{Env: env}, func(t *testing.T, in *editiontest.Instance) {
		f(t, world{t: t, in: in})
	})
}

var admins = map[string]string{"ADMIN_EMAILS": " Root@Example.test , other@example.test", "MANAGE_API_KEY": key}

func TestGuard(t *testing.T) {
	each(t, admins, func(t *testing.T, w world) {
		ada := w.in.Account("ada@example.test")
		root := w.in.Account("root@example.test")
		json := map[string]string{"Content-Type": "application/json", "Origin": w.in.URL}
		with := func(extra map[string]string) map[string]string {
			out := map[string]string{"Content-Type": "application/json", "Origin": w.in.URL}
			for k, v := range extra {
				out[k] = v
			}
			return out
		}
		rename := `{"name":"Ada L."}`

		// The key reads, from either header.
		if s, _ := w.do(request{method: "GET", path: "/api/admin/users", header: map[string]string{"Authorization": "Bearer " + key}}); s != 200 {
			t.Fatalf("bearer key: %d", s)
		}
		if s, _ := w.do(request{method: "GET", path: "/api/admin/users", header: map[string]string{"x-api-key": key}}); s != 200 {
			t.Fatalf("x-api-key: %d", s)
		}
		// It writes when the agent names itself.
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: rename, header: map[string]string{"Content-Type": "application/json", "x-api-key": key, "x-agent-id": "ops-bot"}}); s != 200 || b["name"] != "Ada L." {
			t.Fatalf("key write: %d %v", s, b)
		}
		// A key write without x-agent-id is refused before the handler runs.
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: `{"name":"x"}`, header: map[string]string{"Content-Type": "application/json", "x-api-key": key}}); s != 400 || b["error"] != "agent_id_required" {
			t.Fatalf("no agent: %d %v", s, b)
		}
		// A wrong key is 401, and never falls through to the session.
		if s, _ := w.do(request{method: "GET", path: "/api/admin/users", header: map[string]string{"x-api-key": "wrong"}, cookie: w.in.Session(root, "google")}); s != 401 {
			t.Fatalf("wrong key with an admin cookie: %d", s)
		}
		if s, _ := w.do(request{method: "GET", path: "/api/admin/users", header: map[string]string{"Authorization": "Basic abc"}}); s != 401 {
			t.Fatalf("not a bearer: %d", s)
		}

		// An admin's Google session reads and writes with no agent id.
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: `{"name":null}`, header: json, cookie: w.in.Session(root, "google")}); s != 200 || b["name"] != nil {
			t.Fatalf("session write: %d %v", s, b)
		}
		// A session through another door, a stranger's, and nobody's are not admins.
		for _, c := range []*http.Cookie{w.in.Session(ada, "google"), nil} {
			if s, _ := w.do(request{method: "GET", path: "/api/admin/users", cookie: c}); s != 401 {
				t.Fatalf("not an admin (%v): %d", c, s)
			}
		}

		// The CSRF checks on a write.
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: rename, header: with(map[string]string{"Origin": "https://evil.example"}), cookie: w.in.Session(root, "google")}); s != 403 || b["error"] != "cross_origin" {
			t.Fatalf("cross origin: %d %v", s, b)
		}
		// A cookie's write with no Origin, and no word from the browser that
		// it is same-site, is refused like a foreign one.
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: rename, header: map[string]string{"Content-Type": "application/json"}, cookie: w.in.Session(root, "google")}); s != 403 || b["error"] != "cross_origin" {
			t.Fatalf("no origin: %d %v", s, b)
		}
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: "name=x", header: map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Origin": w.in.URL}, cookie: w.in.Session(root, "google")}); s != 415 || b["error"] != "unsupported_media_type" {
			t.Fatalf("form body: %d %v", s, b)
		}
		if s, _ := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: rename, header: with(map[string]string{"Origin": w.in.URL}), cookie: w.in.Session(root, "google")}); s != 200 {
			t.Fatalf("same origin: %d", s)
		}

		// Malformed JSON and a bad name are 400, not 500; an unknown id is 404.
		for _, body := range []string{"{", `{}`, `{"name":""}`, `{"name":5}`, `{"name":"` + strings.Repeat("x", 81) + `"}`} {
			if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/" + ada, body: body, header: json, cookie: w.in.Session(root, "google")}); s != 400 || b["error"] != "invalid_request" {
				t.Fatalf("%s: %d %v", body, s, b)
			}
		}
		if s, b := w.do(request{method: "PATCH", path: "/api/admin/users/nobody", body: rename, header: json, cookie: w.in.Session(root, "google")}); s != 404 || b["error"] != "not_found" {
			t.Fatalf("unknown: %d %v", s, b)
		}
	})
	// A deploy with no key answers 503, rather than calling the key wrong.
	each(t, map[string]string{"ADMIN_EMAILS": "root@example.test"}, func(t *testing.T, w world) {
		if s, b := w.do(request{method: "GET", path: "/api/admin/users", header: map[string]string{"x-api-key": "anything"}}); s != 503 || b["error"] != "unavailable" {
			t.Fatalf("no key configured: %d %v", s, b)
		}
	})
}

func TestMe(t *testing.T) {
	each(t, admins, func(t *testing.T, w world) {
		root, ada := w.in.Account("root@example.test"), w.in.Account("ada@example.test")
		if s, b := w.do(request{method: "GET", path: "/api/admin/me", cookie: w.in.Session(root, "google")}); s != 200 || b["email"] != "root@example.test" {
			t.Fatalf("admin: %d %v", s, b)
		}
		// A signed-in stranger is sent to "denied", nobody to the sign-in.
		if s, b := w.do(request{method: "GET", path: "/api/admin/me", cookie: w.in.Session(ada, "google")}); s != 403 || b["email"] != "ada@example.test" {
			t.Fatalf("stranger: %d %v", s, b)
		}
		if s, _ := w.do(request{method: "GET", path: "/api/admin/me", cookie: w.in.Session(root, "password")}); s != 200 {
			t.Fatalf("password session: %d", s)
		}
		if s, _ := w.do(request{method: "GET", path: "/api/admin/me"}); s != 401 {
			t.Fatalf("nobody: %d", s)
		}
	})
}

func TestUsersAndStats(t *testing.T) {
	each(t, admins, func(t *testing.T, w world) {
		read := map[string]string{"x-api-key": key}
		w.in.Account("ada@example.test")
		w.in.Account("grace@example.test")
		_, stats := w.do(request{method: "GET", path: "/api/admin/stats", header: read})
		if stats["users"] != 2.0 || stats["newInWeek"] != 2.0 {
			t.Fatalf("stats %v", stats)
		}
		s, page := w.do(request{method: "GET", path: "/api/admin/users?size=1&page=2", header: read})
		if s != 200 || page["total"] != 2.0 || page["page"] != 2.0 || page["totalPages"] != 2.0 || len(page["users"].([]any)) != 1 {
			t.Fatalf("page %d %v", s, page)
		}
		row := page["users"].([]any)[0].(map[string]any)
		for _, k := range []string{"id", "email", "name", "locale", "createdAt"} {
			if _, ok := row[k]; !ok {
				t.Fatalf("row without %s: %v", k, row)
			}
		}
		_, found := w.do(request{method: "GET", path: "/api/admin/users?q=GRACE", header: read})
		if found["total"] != 1.0 {
			t.Fatalf("search %v", found)
		}
		for _, q := range []string{"size=0", "size=201", "page=0", "page=x"} {
			if s, b := w.do(request{method: "GET", path: "/api/admin/users?" + q, header: read}); s != 400 || b["error"] != "invalid_request" {
				t.Fatalf("%s: %d %v", q, s, b)
			}
		}
	})
}

// The index lists every route registered, once, with what it takes.
func TestIndex(t *testing.T) {
	each(t, admins, func(t *testing.T, w world) {
		s, b := w.do(request{method: "GET", path: "/api/admin", header: map[string]string{"x-api-key": key}})
		if s != 200 {
			t.Fatalf("index: %d", s)
		}
		listed := b["routes"].([]any)
		if len(listed) != 8 {
			t.Fatalf("listed %d of %d", len(listed), 8)
		}
		seen := map[string]bool{}
		for _, r := range listed {
			row := r.(map[string]any)
			id := row["method"].(string) + " " + row["path"].(string)
			if seen[id] {
				t.Fatalf("listed twice: %s", id)
			}
			seen[id] = true
			if _, ok := row["response"].(map[string]any); !ok {
				t.Fatalf("%s: no response schema", id)
			}
			_, hasBody := row["body"]
			_, hasQuery := row["query"]
			if row["method"] == "GET" && hasBody || row["method"] != "GET" && hasQuery {
				t.Fatalf("%s: a body on a read or a query on a write", id)
			}
			want := map[bool]string{true: "key or session", false: "key with x-agent-id, or session"}[row["method"] == "GET"]
			if row["access"] != want && row["access"] != "anyone" && row["access"] != "Google operator session only" {
				t.Fatalf("%s: access %v", id, row["access"])
			}
		}
		// Each listed route answers something other than the catch-all 404.
		for id := range seen {
			method, path, _ := strings.Cut(id, " ")
			path = strings.ReplaceAll(path, "{id}", "x")
			body := ""
			if method != "GET" {
				body = "{}"
			}
			if s, b := w.do(request{method: method, path: path, body: body, header: map[string]string{"x-api-key": key, "x-agent-id": "t", "Content-Type": "application/json"}}); s == 404 && b["error"] == "not_found" && method == "GET" {
				t.Fatalf("%s is listed but not served", id)
			}
		}
	})
}

func TestConsolePages(t *testing.T) {
	each(t, admins, func(t *testing.T, w world) {
		for _, p := range []string{"/manage/", "/manage/users", "/manage/denied"} {
			res, err := http.Get(w.in.URL + p)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Security-Policy"), "script-src 'self'") {
				t.Fatalf("%s: %d %q", p, res.StatusCode, res.Header.Get("Content-Security-Policy"))
			}
		}
	})
}

// An instance with no ADMIN_EMAILS has no console: the member site's.
func TestNoConsoleWithoutAdmins(t *testing.T) {
	each(t, map[string]string{"MANAGE_API_KEY": key}, func(t *testing.T, w world) {
		if s, _ := w.do(request{method: "GET", path: "/api/admin", header: map[string]string{"x-api-key": key}}); s != 404 {
			t.Fatalf("/api/admin: %d", s)
		}
		if s, _ := w.do(request{method: "GET", path: "/api/admin/me"}); s != 404 {
			t.Fatalf("/api/admin/me: %d", s)
		}
	})
}

func TestRolesAndTeamDirectory(t *testing.T) {
	for _, role := range []string{"user", "manage", "combined"} {
		t.Run(role, func(t *testing.T) {
			each(t, map[string]string{"SERVICE_ROLE": role, "ADMIN_EMAILS": "root@example.test", "MANAGE_API_KEY": key}, func(t *testing.T, w world) {
				root := w.in.Account("root@example.test")
				outsider := w.in.Account("member@example.test")
				team := w.in.Team(outsider)
				cookie := w.in.Session(root, "password")
				want := 200
				if role == "user" {
					want = 404
				}
				s, b := w.do(request{method: "GET", path: "/api/admin/teams?q=member%40example.test", cookie: cookie})
				if s != want {
					t.Fatalf("admin list: %d %v", s, b)
				}
				if role != "user" {
					if b["total"] != 1.0 {
						t.Fatalf("team search: %v", b)
					}
					s, b = w.do(request{method: "GET", path: "/api/admin/teams/" + team, cookie: cookie})
					if s != 200 || b["total"] != 1.0 {
						t.Fatalf("team detail: %d %v", s, b)
					}
					if s, _ := w.do(request{method: "GET", path: "/api/admin/system", cookie: w.in.Session(outsider, "password")}); s != 401 {
						t.Fatalf("member reached system: %d", s)
					}
				}
				for _, path := range []string{"/api/teams", "/api/configs"} {
					s, _ := w.do(request{method: "GET", path: path, cookie: cookie})
					if role == "manage" && s != 404 {
						t.Fatalf("management exposes %s: %d", path, s)
					}
					if role != "manage" && s != 200 {
						t.Fatalf("user route %s: %d", path, s)
					}
				}
				for _, path := range []string{"/api/llm/chat/completions", "/api/auth/plugin/code", "/api/auth/plugin/token"} {
					if role == "manage" {
						s, _ := w.do(request{method: "POST", path: path, body: "{}", cookie: cookie, header: map[string]string{"Content-Type": "application/json", "Origin": w.in.URL}})
						if s != 404 {
							t.Fatalf("management exposes %s: %d", path, s)
						}
					}
				}
			})
		})
	}
}

func TestRootMountedEditionConsole(t *testing.T) {
	ext := edition.Extension{Name: "operator", Mount: func(h edition.Host) (func(), error) {
		h.SetAdminConsole(edition.AdminConsole{Base: "", GoogleOnly: true, Files: fstest.MapFS{"index.html": {Data: []byte("management test")}}})
		return nil, nil
	}}
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{Env: map[string]string{"SERVICE_ROLE": "manage", "ADMIN_EMAILS": "root@example.test"}}, func(t *testing.T, in *editiontest.Instance) {
		for _, path := range []string{"/", "/users"} {
			res, err := http.Get(in.URL + path)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Fatalf("page %s: %d", path, res.StatusCode)
			}
		}
		w := world{t: t, in: in}
		if s, _ := w.do(request{method: "GET", path: "/api/teams"}); s != 404 {
			t.Fatalf("API fallback: %d", s)
		}
	})
}

func TestTeamAdminsCannotControlInstancePasswords(t *testing.T) {
	each(t, map[string]string{"ADMIN_EMAILS": "root@example.test,future@example.test"}, func(t *testing.T, w world) {
		owner := w.in.Account("owner@example.test")
		root := w.in.Account("root@example.test")
		team := w.in.Team(owner)
		w.in.Member(team, root)
		headers := map[string]string{"Content-Type": "application/json", "Origin": w.in.URL}
		cookie := w.in.Session(owner, "password")
		for _, req := range []request{
			{method: "POST", path: "/api/teams/" + team + "/members", body: `{"email":"future@example.test"}`},
			{method: "POST", path: "/api/teams/" + team + "/members/" + root + "/password", body: `{}`},
		} {
			req.cookie = cookie
			req.header = headers
			s, b := w.do(req)
			if s != 403 || b["error"] != "not_allowed" {
				t.Fatalf("operator credentials: %d %v", s, b)
			}
		}
	})
}
