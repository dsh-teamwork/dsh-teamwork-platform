// Package web serves what a browser loads that is not the API: the public
// pages and the files a crawler reads, and the console (apps/web, or the
// edition's web app that composes it) for every other path. Both are built
// into dist and embedded in the binary; under DEV_VITE they come from the web
// Vite server instead, and every decision below stays the same.
//
// The public pages are prerendered when the web app is built
// (apps/web/scripts/prerender.mjs) into dist/public, one file per page:
// home.{locale}[.signed-in].html for /, docs.{slug}.{locale}.html for /docs,
// and {name}.{locale}.html or {name}.html for /{name}, which is how an
// edition adds a page (or replaces one) without the server knowing it. Each
// names the site's own address as %APP_URL%, written over with APP_URL here,
// since the binary is built once and deployed anywhere.
package web

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"
)

//go:embed all:dist
var dist embed.FS

// appURLPlaceholder is what a prerendered page names the site's address by
// (apps/web/src/public/site.ts).
const appURLPlaceholder = "%APP_URL%"

// Options is what the pages depend on beyond the built files.
type Options struct {
	AppURL string // the public origin, without a trailing slash

	// PostHogKey, when set, turns on browser analytics: every page carries it,
	// and PostHogHost, as meta tags apps/web/src/lib/analytics.ts reads.
	PostHogKey, PostHogHost string

	// Viewer is who is asking: the signed-in profile's locale ("" for none)
	// and whether anybody is signed in. Nil is nobody.
	Viewer func(r *http.Request) (locale string, signedIn bool)
}

// robotsDisallow are the paths no crawler is asked to read: the API and every
// signed-in or sign-in screen. The sitemap lists none of them.
var robotsDisallow = []string{"/api/", "/account", "/auth/", "/teams", "/plugin"}

// pageName is a public page's own address, /{name}: one path segment.
var pageName = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// Handler serves the embedded build, or files when an edition replaced it.
func Handler(files fs.FS, o Options) http.Handler {
	if files == nil {
		files, _ = fs.Sub(dist, "dist")
	}
	return New(files, o)
}

// New serves the build in root.
func New(root fs.FS, o Options) http.Handler {
	s := newSite(o)
	b := &built{root: root, files: http.FileServerFS(root), pages: map[string][]byte{}}
	if names, err := fs.Glob(root, "public/*.html"); err == nil {
		for _, name := range names {
			if raw, err := fs.ReadFile(root, name); err == nil {
				b.pages[path.Base(name)] = s.fill(raw)
			}
		}
	}
	if raw, err := fs.ReadFile(root, "index.html"); err == nil {
		b.console = s.fill(raw)
	}
	s.src = b
	s.robots, s.sitemap = s.crawlerFiles()
	return s
}

// Dev serves the pages from the web Vite server at origin (DEV_VITE): its
// public pages endpoint (apps/web/scripts/vite-pages.mjs), its index.html,
// and every module and file it serves.
func Dev(origin string, o Options) http.Handler {
	u, err := url.Parse(origin)
	if err != nil {
		panic(err)
	}
	s := newSite(o)
	s.src = &vite{origin: origin, client: &http.Client{Timeout: 30 * time.Second}, proxy: DevProxy(u, "the web Vite server"), site: s}
	return s
}

// DevProxy sends every request to a Vite server at u, and says which one to
// start when it is not running.
func DevProxy(u *url.URL, name string) http.Handler {
	p := httputil.NewSingleHostReverseProxy(u)
	p.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, fmt.Sprintf("DEV_VITE: %s on %s is not answering; start it with `pnpm dev`. (%v)", name, u.Host, err), http.StatusBadGateway)
	}
	return p
}

func newSite(o Options) *site {
	meta := ""
	if o.PostHogKey != "" {
		meta = fmt.Sprintf(`<meta name="posthog-key" content="%s"/>`, html.EscapeString(o.PostHogKey))
		if o.PostHogHost != "" {
			meta += fmt.Sprintf(`<meta name="posthog-host" content="%s"/>`, html.EscapeString(o.PostHogHost))
		}
	}
	return &site{opts: o, meta: []byte(meta + "</head>")}
}

// source is where the build's pages and files come from.
type source interface {
	// page is a public page by file name, ready to send.
	page(name string) ([]byte, bool)
	// names is every public page's file name.
	names() []string
	// index is the console's index.html, ready to send.
	index() ([]byte, bool)
	// file serves r from the build's own files, and reports whether it did.
	file(w http.ResponseWriter, r *http.Request) bool
	// missing is what a request for the console gets when there is no index.
	missing() string
}

type site struct {
	src  source
	opts Options
	meta []byte

	robots, sitemap []byte // nil: written per request, from a source that changes
}

// fill names the site's address and the analytics settings in a page.
func (s *site) fill(b []byte) []byte {
	b = bytes.ReplaceAll(b, []byte(appURLPlaceholder), []byte(s.opts.AppURL))
	return bytes.Replace(b, []byte("</head>"), s.meta, 1)
}

func (s *site) viewer(r *http.Request) (locale string, signedIn bool) {
	profile := ""
	if s.opts.Viewer != nil {
		profile, signedIn = s.opts.Viewer(r)
	}
	return ViewerLocale(r, profile), signedIn
}

func (s *site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	clean := path.Clean("/" + r.URL.Path)
	switch clean {
	case "/":
		locale, signedIn := s.viewer(r)
		name := "home." + locale
		if signedIn {
			name += ".signed-in"
		}
		if b, ok := s.src.page(name + ".html"); ok {
			// One address, four pages: a cache must key on what chose this one.
			w.Header().Set("Vary", vary)
			s.html(w, b)
			return
		}
	case "/docs":
		s.doc(w, r, "index")
		return
	case "/robots.txt", "/sitemap.xml":
		robots, sitemap := s.robots, s.sitemap
		if robots == nil {
			robots, sitemap = s.crawlerFiles()
		}
		if clean == "/robots.txt" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write(robots)
		} else {
			w.Header().Set("Content-Type", "application/xml; charset=utf-8")
			w.Write(sitemap)
		}
		return
	}
	if slug, ok := strings.CutPrefix(clean, "/docs/"); ok {
		s.doc(w, r, slug)
		return
	}
	// /{name}: a page in the viewer's language, else one in a single language
	// (the legal pages). Without one, the console routes the path itself.
	if name := clean[1:]; pageName.MatchString(name) && name != "home" && name != "docs" {
		locale, _ := s.viewer(r)
		if b, ok := s.src.page(name + "." + locale + ".html"); ok {
			w.Header().Set("Vary", vary)
			s.html(w, b)
			return
		}
		if b, ok := s.src.page(name + ".html"); ok {
			s.html(w, b)
			return
		}
	}
	if s.src.file(w, r) {
		return
	}
	index, ok := s.src.index()
	if !ok {
		http.Error(w, s.src.missing(), http.StatusNotFound)
		return
	}
	// The console renders in the viewer's language, the profile's first, as
	// the home page does; it reads it from the root element.
	locale, _ := s.viewer(r)
	w.Header().Set("Vary", vary)
	s.html(w, bytes.Replace(index, []byte(`<html lang="en">`), []byte(`<html lang="`+locale+`" data-locale="`+locale+`">`), 1))
}

// doc answers /docs and /docs/{slug} with the page in the viewer's language
// (docs.{slug}.{locale}.html, apps/web/src/public/docs.tsx), as the home
// page picks its own; a page this build does not hold is not found.
func (s *site) doc(w http.ResponseWriter, r *http.Request, slug string) {
	locale, _ := s.viewer(r)
	b, ok := s.src.page("docs." + slug + "." + locale + ".html")
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Vary", vary)
	s.html(w, b)
}

// vary is every request header that chooses which page an address answers
// with: the session (a cookie, or a Bearer token), the locale cookie and the
// browser's languages.
const vary = "Cookie, Authorization, Accept-Language"

func (s *site) html(w http.ResponseWriter, b []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(b)
}

// built is the embedded build.
type built struct {
	root    fs.FS
	files   http.Handler
	pages   map[string][]byte // dist/public's pages by file name, ready to send
	console []byte            // index.html, ready to send
}

func (b *built) page(name string) ([]byte, bool) { p, ok := b.pages[name]; return p, ok }

func (b *built) names() []string {
	names := make([]string, 0, len(b.pages))
	for name := range b.pages {
		names = append(names, name)
	}
	return names
}

func (b *built) index() ([]byte, bool) { return b.console, b.console != nil }

func (b *built) missing() string {
	return "The web app is not built into this binary (pnpm --filter @dsh-teamwork/web build)."
}

// file serves a file of the build as it is, but never a prerendered page
// directly: those still hold the placeholder.
func (b *built) file(w http.ResponseWriter, r *http.Request) bool {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "opengraph-image.png" {
		if _, err := fs.Stat(b.root, "public/"+name); err != nil {
			return false
		}
		w.Header().Set("Cache-Control", "public, max-age=3600")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/public/" + name
		b.files.ServeHTTP(w, r2)
		return true
	}
	if name == "" || name == "index.html" || strings.HasPrefix(name, "public/") {
		return false
	}
	if info, err := fs.Stat(b.root, name); err != nil || info.IsDir() {
		return false
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	b.files.ServeHTTP(w, r)
	return true
}

// vite is the web Vite server in development: pages rendered fresh from
// source, and its modules and files passed through.
type vite struct {
	origin string
	client *http.Client
	proxy  http.Handler
	site   *site
}

func (v *vite) get(p string) ([]byte, bool) {
	res, err := v.client.Get(v.origin + p)
	if err != nil {
		return nil, false
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	return b, err == nil && res.StatusCode == http.StatusOK
}

func (v *vite) page(name string) ([]byte, bool) {
	b, ok := v.get("/__pages/" + url.PathEscape(name))
	if !ok {
		return nil, false
	}
	return v.site.fill(b), true
}

func (v *vite) names() []string {
	var names []string
	if b, ok := v.get("/__pages"); ok {
		_ = json.Unmarshal(b, &names)
	}
	return names
}

func (v *vite) index() ([]byte, bool) { return v.get("/index.html") }

func (v *vite) missing() string {
	return "DEV_VITE: the web Vite server on " + v.origin + " is not answering; start it with `pnpm dev`."
}

// file passes everything but a page load to Vite: a page load (HTML wanted,
// and no file extension) gets the console's index, as a built binary's would.
func (v *vite) file(w http.ResponseWriter, r *http.Request) bool {
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.Contains(r.Header.Get("Accept"), "text/html") && path.Ext(r.URL.Path) == "" {
		return false
	}
	v.proxy.ServeHTTP(w, r)
	return true
}

// robotsGroups are robots.txt's groups: everybody first, kept off the
// signed-in screens, then the AI training crawlers, kept off everything.
func robotsGroups() []RobotsGroup {
	return []RobotsGroup{
		{UserAgents: []string{"*"}, Allow: []string{"/"}, Disallow: robotsDisallow},
		AITrainingRule(),
	}
}

// crawlerFiles are robots.txt and sitemap.xml, from APP_URL and never the
// Host header, which a stranger can set. The sitemap lists the home page, the
// documentation, and every other public page this build holds.
func (s *site) crawlerFiles() (robots, sitemap []byte) {
	var b strings.Builder
	for _, g := range robotsGroups() {
		for _, a := range g.UserAgents {
			fmt.Fprintf(&b, "User-Agent: %s\n", a)
		}
		for _, p := range g.Allow {
			fmt.Fprintf(&b, "Allow: %s\n", p)
		}
		for _, p := range g.Disallow {
			fmt.Fprintf(&b, "Disallow: %s\n", p)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "Sitemap: %s/sitemap.xml\n", s.opts.AppURL)
	robots = []byte(b.String())

	// The home page, each documentation page and every other public page
	// once, by its English (or only) file: the locale is never in the URL.
	urls := []string{s.opts.AppURL}
	var docs, pages []string
	for _, name := range s.src.names() {
		if slug, ok := strings.CutPrefix(name, "docs."); ok {
			if slug, ok := strings.CutSuffix(slug, ".en.html"); ok {
				docs = append(docs, slug)
			}
			continue
		}
		page, ok := strings.CutSuffix(name, ".en.html")
		if !ok {
			page, ok = strings.CutSuffix(name, ".html")
		}
		if ok && pageName.MatchString(page) && page != "home" {
			pages = append(pages, page)
		}
	}
	slices.Sort(docs)
	for _, slug := range docs {
		if slug == "index" {
			urls = append(urls, s.opts.AppURL+"/docs")
		} else {
			urls = append(urls, s.opts.AppURL+"/docs/"+slug)
		}
	}
	slices.Sort(pages)
	for _, page := range slices.Compact(pages) {
		urls = append(urls, s.opts.AppURL+"/"+page)
	}
	b.Reset()
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, u := range urls {
		fmt.Fprintf(&b, "<url>\n<loc>%s</loc>\n</url>\n", html.EscapeString(u))
	}
	b.WriteString("</urlset>\n")
	return robots, []byte(b.String())
}
