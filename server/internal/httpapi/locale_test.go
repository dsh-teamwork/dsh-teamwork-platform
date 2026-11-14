package httpapi_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// homes is a console build whose home pages say which they are.
func homes() fstest.MapFS {
	b := fstest.MapFS{"index.html": {Data: []byte("<html><head></head><body>spa</body></html>")}}
	for _, name := range []string{"home.en", "home.en.signed-in", "home.zh-CN", "home.zh-CN.signed-in"} {
		b["public/"+name+".html"] = &fstest.MapFile{Data: []byte("<html><head></head><body>" + name + "</body></html>")}
	}
	return b
}

func (b *browser) home(acceptLanguage string) string {
	r := do(b.e.t, b.client, "GET", b.e.url+"/", nil, map[string]string{"Accept-Language": acceptLanguage})
	return strings.TrimSuffix(strings.TrimPrefix(string(r.body), "<html><head></head><body>"), "</body></html>")
}

func (b *browser) cookie(name string) string {
	u, _ := url.Parse(b.e.url)
	for _, c := range b.client.Jar.Cookies(u) {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

func TestHomeAndTheLocale(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{web: homes()})

		t.Run("signed out: Accept-Language, then the chosen cookie", func(t *testing.T) {
			b := e.browser()
			if got := b.home("zh-CN,en;q=0.5"); got != "home.zh-CN" {
				t.Fatalf("%s", got)
			}
			if r := b.post("/api/locale", map[string]string{"locale": "en"}); r.status != http.StatusNoContent {
				t.Fatalf("%d %s", r.status, r.body)
			}
			if b.cookie("locale") != "en" {
				t.Fatal("no locale cookie")
			}
			if got := b.home("zh-CN"); got != "home.en" {
				t.Fatalf("%s", got)
			}
		})

		t.Run("signed in: the profile, over the cookie, on the signed-in page", func(t *testing.T) {
			b := e.admin("a@x.io")
			if got := b.home("en"); got != "home.en.signed-in" {
				t.Fatalf("%s", got)
			}
			if r := b.post("/api/locale", map[string]string{"locale": "zh-CN"}); r.status != http.StatusNoContent {
				t.Fatalf("%d %s", r.status, r.body)
			}
			if v := must(t, b.get("/api/profile"), 200); v["locale"] != "zh-CN" {
				t.Fatalf("profile %v", v)
			}
			u, _ := url.Parse(e.url)
			b.client.Jar.SetCookies(u, []*http.Cookie{{Name: "locale", Value: "en", Path: "/"}})
			if got := b.home("en"); got != "home.zh-CN.signed-in" {
				t.Fatalf("%s", got)
			}
		})

		t.Run("refuses a locale that is not one, and a write from another site", func(t *testing.T) {
			b := e.browser()
			if r := b.post("/api/locale", map[string]string{"locale": "fr"}); r.status != http.StatusBadRequest {
				t.Fatalf("%d %s", r.status, r.body)
			}
			b.origin = "https://evil.example"
			if r := b.post("/api/locale", map[string]string{"locale": "en"}); r.status != http.StatusForbidden || r.code() != "cross_origin" {
				t.Fatalf("%d %s", r.status, r.body)
			}
			if b.cookie("locale") != "" {
				t.Fatal("a refused choice set the cookie")
			}
		})
	})
}
