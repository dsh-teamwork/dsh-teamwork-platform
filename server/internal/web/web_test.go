package web

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

// build is a console build as prerender.mjs lays it out: each home page says
// which it is, and names the site the way the real ones do.
func build(legal bool) fstest.MapFS {
	page := func(id string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte(`<!doctype html><html><head><link rel="canonical" href="%APP_URL%/"/></head><body>` + id + `</body></html>`)}
	}
	b := fstest.MapFS{
		"index.html":                       {Data: []byte(`<!doctype html><html lang="en"><head><meta name="robots" content="noindex"/></head><body>spa</body></html>`)},
		"assets/index-abc.js":              {Data: []byte("console.log(1)")},
		"public/home.en.html":              page("home.en"),
		"public/home.en.signed-in.html":    page("home.en.signed-in"),
		"public/home.zh-CN.html":           page("home.zh-CN"),
		"public/home.zh-CN.signed-in.html": page("home.zh-CN.signed-in"),
		"public/opengraph-image.png":       {Data: []byte("\x89PNG")},
	}
	if legal {
		b["public/privacy.html"] = page("privacy")
		b["public/terms.html"] = page("terms")
	}
	return b
}

type viewer struct {
	locale   string
	signedIn bool
}

func serve(t *testing.T, h http.Handler, path string, header map[string]string) *http.Response {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w.Result()
}

func body(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func handler(root fs.FS, v *viewer) http.Handler {
	o := Options{AppURL: "https://example.com"}
	if v != nil {
		o.Viewer = func(*http.Request) (string, bool) { return v.locale, v.signedIn }
	}
	return New(root, o)
}

func TestHomePicksTheViewersPage(t *testing.T) {
	cases := []struct {
		name   string
		viewer *viewer
		header map[string]string
		want   string
	}{
		{"nobody, nothing said", nil, nil, "home.en"},
		{"Accept-Language", nil, map[string]string{"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}, "home.zh-CN"},
		{"Accept-Language by q, not by order", nil, map[string]string{"Accept-Language": "en;q=0.5, zh;q=0.9"}, "home.zh-CN"},
		{"Accept-Language with q=0 dropped", nil, map[string]string{"Accept-Language": "zh;q=0, en;q=0.1"}, "home.en"},
		{"Traditional Chinese is not Simplified", nil, map[string]string{"Accept-Language": "zh-TW, en;q=0.5"}, "home.en"},
		{"the cookie over Accept-Language", nil, map[string]string{"Cookie": "locale=zh-CN", "Accept-Language": "en"}, "home.zh-CN"},
		{"a cookie that is no locale is ignored", nil, map[string]string{"Cookie": "locale=fr", "Accept-Language": "zh"}, "home.zh-CN"},
		{"signed in, no profile locale", &viewer{signedIn: true}, map[string]string{"Cookie": "locale=zh-CN"}, "home.zh-CN.signed-in"},
		{"the profile over the cookie", &viewer{locale: "en", signedIn: true}, map[string]string{"Cookie": "locale=zh-CN", "Accept-Language": "zh"}, "home.en.signed-in"},
		{"the profile's Chinese", &viewer{locale: "zh-CN", signedIn: true}, map[string]string{"Accept-Language": "en"}, "home.zh-CN.signed-in"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := serve(t, handler(build(false), c.viewer), "/", c.header)
			got := body(t, res)
			if res.StatusCode != 200 || !strings.Contains(got, "<body>"+c.want+"</body>") {
				t.Fatalf("%d %s, want %s", res.StatusCode, got, c.want)
			}
			if res.Header.Get("Vary") != "Cookie, Authorization, Accept-Language" || res.Header.Get("Cache-Control") != "no-cache" {
				t.Fatalf("headers %v", res.Header)
			}
		})
	}
}

func TestAppURLNeverReachesAResponse(t *testing.T) {
	roots := map[string]fs.FS{"a build with legal pages": build(true)}
	// The build embedded in this binary, where one was made.
	if real, _ := fs.Sub(dist, "dist"); real != nil {
		if _, err := fs.Stat(real, "public/home.en.html"); err == nil {
			roots["the embedded build"] = real
		}
	}
	for name, root := range roots {
		t.Run(name, func(t *testing.T) {
			paths := []string{"/", "/privacy", "/terms", "/sign-in", "/teams/x", "/public/home.en.html", "/public/privacy.html", "/robots.txt", "/sitemap.xml"}
			for _, v := range []*viewer{nil, {locale: "zh-CN", signedIn: true}} {
				for _, p := range paths {
					got := body(t, serve(t, handler(root, v), p, nil))
					if strings.Contains(got, appURLPlaceholder) {
						t.Fatalf("%s carries the placeholder: %.200s", p, got)
					}
				}
			}
			if got := body(t, serve(t, handler(root, nil), "/", nil)); !strings.Contains(got, `href="https://example.com/"`) {
				t.Fatalf("home does not name APP_URL: %.300s", got)
			}
		})
	}
}

func TestPrerenderedPagesAreNotServedAsFiles(t *testing.T) {
	got := body(t, serve(t, handler(build(true), nil), "/public/home.en.html", nil))
	if !strings.Contains(got, "<body>spa</body>") {
		t.Fatalf("%s", got)
	}
}

func TestLegalPagesOnlyWhenBuilt(t *testing.T) {
	without := handler(build(false), nil)
	for _, p := range []string{"/privacy", "/terms"} {
		if res := serve(t, without, p, nil); res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s without LEGAL_DIR: %d", p, res.StatusCode)
		}
	}
	with := handler(build(true), nil)
	for _, p := range []string{"/privacy", "/terms"} {
		res := serve(t, with, p, nil)
		if got := body(t, res); res.StatusCode != 200 || !strings.Contains(got, "<body>"+p[1:]+"</body>") {
			t.Fatalf("%s: %d %s", p, res.StatusCode, got)
		}
	}
}

func TestTheShareCard(t *testing.T) {
	res := serve(t, handler(build(false), nil), "/opengraph-image.png", nil)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || body(t, res) != "\x89PNG" {
		t.Fatalf("%d %v", res.StatusCode, res.Header)
	}
}

func TestTheConsoleKeepsEveryOtherPath(t *testing.T) {
	h := handler(build(false), nil)
	for _, p := range []string{"/sign-in", "/teams", "/teams/abc/members", "/index.html"} {
		got := body(t, serve(t, h, p, nil))
		if !strings.Contains(got, `<meta name="robots" content="noindex"/>`) || !strings.Contains(got, "spa") {
			t.Fatalf("%s: %s", p, got)
		}
	}
	res := serve(t, h, "/assets/index-abc.js", nil)
	if res.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("an asset: %v", res.Header)
	}
}

func TestBrowserAnalyticsKey(t *testing.T) {
	off := New(build(false), Options{AppURL: "https://example.com"})
	for _, p := range []string{"/", "/sign-in"} {
		if got := body(t, serve(t, off, p, nil)); strings.Contains(got, "posthog") {
			t.Fatalf("no key, yet %s names PostHog: %s", p, got)
		}
	}
	on := New(build(false), Options{AppURL: "https://example.com", PostHogKey: `phc_"x`, PostHogHost: "https://eu.i.posthog.com"})
	for _, p := range []string{"/", "/sign-in"} {
		got := body(t, serve(t, on, p, nil))
		if !strings.Contains(got, `<meta name="posthog-key" content="phc_&#34;x"/><meta name="posthog-host" content="https://eu.i.posthog.com"/></head>`) {
			t.Fatalf("%s: %s", p, got)
		}
	}
}

// Ported from apps/web/src/app/__tests__/seo.test.ts.
func TestCrawlerFiles(t *testing.T) {
	t.Run("names the sitemap from APP_URL", func(t *testing.T) {
		got := body(t, serve(t, handler(build(false), nil), "/robots.txt", map[string]string{"Host": "evil.example"}))
		if !strings.HasSuffix(got, "\nSitemap: https://example.com/sitemap.xml\n") {
			t.Fatalf("%s", got)
		}
	})

	sitemap := func(legal bool) string {
		res := serve(t, handler(build(legal), nil), "/sitemap.xml", nil)
		if res.Header.Get("Content-Type") != "application/xml; charset=utf-8" {
			t.Fatalf("%v", res.Header)
		}
		return body(t, res)
	}
	t.Run("lists the public pages and none of the signed-in ones", func(t *testing.T) {
		want := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n<url>\n<loc>https://example.com</loc>\n</url>\n</urlset>\n"
		if got := sitemap(false); got != want {
			t.Fatalf("%s", got)
		}
	})
	t.Run("lists the legal pages only where the build published them", func(t *testing.T) {
		got := sitemap(true)
		for _, u := range []string{"https://example.com</loc>", "https://example.com/privacy</loc>", "https://example.com/terms</loc>"} {
			if !strings.Contains(got, "<loc>"+u) {
				t.Fatalf("%s is missing %s", got, u)
			}
		}
		if strings.Count(got, "<loc>") != 3 {
			t.Fatalf("%s", got)
		}
	})
	t.Run("keeps a page out of the sitemap only if robots.txt also refuses the path it lives on", func(t *testing.T) {
		var disallow []string
		for _, g := range robotsGroups() {
			disallow = append(disallow, g.Disallow...)
		}
		for _, p := range []string{"/account", "/api/", "/auth/", "/teams", "/plugin"} {
			if !slices.Contains(disallow, p) {
				t.Fatalf("robots.txt does not refuse %s", p)
			}
		}
	})
	t.Run("writes robots.txt in the groups' order", func(t *testing.T) {
		got := body(t, serve(t, handler(build(false), nil), "/robots.txt", nil))
		want := "User-Agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account\nDisallow: /auth/\nDisallow: /teams\nDisallow: /plugin\n\nUser-Agent: GPTBot\n"
		if !strings.HasPrefix(got, want) || !strings.Contains(got, "User-Agent: cohere-ai\nAllow: /llms.txt\nDisallow: /\n\n") {
			t.Fatalf("%s", got)
		}
	})
}

func TestMatchLocale(t *testing.T) {
	cases := map[string]string{
		"":                       "en",
		"fr":                     "en",
		"zh":                     "zh-CN",
		"zh-Hans":                "zh-CN",
		"zh-SG":                  "zh-CN",
		"zh-HK, zh-Hant-CN, fr":  "en",
		"zh-Hant, zh-CN;q=0.5":   "zh-CN",
		"en-GB":                  "en",
		"*, zh;q=0.1":            "zh-CN",
		"fr;q=1, en;q=x, zh;q=1": "zh-CN",
	}
	for header, want := range cases {
		if got := MatchLocale(AcceptLanguage(header)); got != want {
			t.Errorf("%q: %s, want %s", header, got, want)
		}
	}
}

// The console renders in the viewer's language, the profile's first, as the
// home page does: the server writes it on the root element, and the answer
// varies with everything that chose it.
func TestTheConsoleCarriesTheViewersLocale(t *testing.T) {
	root := build(false)
	cases := []struct {
		name   string
		v      *viewer
		header map[string]string
		want   string
	}{
		{"browser", nil, map[string]string{"Accept-Language": "zh-CN,en;q=0.5"}, "zh-CN"},
		{"cookie over browser", nil, map[string]string{"Accept-Language": "zh-CN", "Cookie": "locale=en"}, "en"},
		{"profile over cookie", &viewer{locale: "zh-CN", signedIn: true}, map[string]string{"Cookie": "locale=en"}, "zh-CN"},
	}
	for _, c := range cases {
		res := serve(t, handler(root, c.v), "/teams", c.header)
		got := body(t, res)
		if !strings.Contains(got, `<html lang="`+c.want+`" data-locale="`+c.want+`">`) {
			t.Errorf("%s: %s", c.name, got)
		}
		if res.Header.Get("Vary") != "Cookie, Authorization, Accept-Language" {
			t.Errorf("%s: Vary %q", c.name, res.Header.Get("Vary"))
		}
	}
	if v := serve(t, handler(root, nil), "/", nil).Header.Get("Vary"); !strings.Contains(v, "Authorization") {
		t.Errorf("home Vary %q: a Bearer token also chooses the signed-in page", v)
	}
}

// A q the Node parser reads as NaN is dropped here too, whatever Go's own
// float parser would make of it.
func TestAcceptLanguageReadsQLikeNode(t *testing.T) {
	for header, want := range map[string]string{
		"en;q=0.9, zh;q=inf":  "en",
		"en;q=0.9, zh;q=NaN":  "en",
		"en;q=0.9, zh;q=0x1":  "en",
		"en;q=0.9, zh;q=1_0":  "en",
		"en;q=0.5, zh;q=0.8":  "zh-CN",
		"en;q=0.9, zh;q=1e-1": "en",
	} {
		if got := MatchLocale(AcceptLanguage(header)); got != want {
			t.Errorf("%q: %s, want %s", header, got, want)
		}
	}
}
