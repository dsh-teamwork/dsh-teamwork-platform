// Package web serves what a browser loads that is not the API: the public
// pages (home, privacy, terms) and the files a crawler reads, and the console
// (apps/console) for every other path. Both are built into dist and embedded
// in the binary.
//
// The public pages are prerendered when the console is built
// (apps/console/scripts/prerender.mjs) into dist/public: home once per locale
// and sign-in state, privacy and terms only when that build had LEGAL_DIR.
// Each names the site's own address as %APP_URL%, written over with APP_URL
// here, since the binary is built once and deployed anywhere.
package web

import (
	"bytes"
	"embed"
	"fmt"
	"html"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var dist embed.FS

// appURLPlaceholder is what a prerendered page names the site's address by
// (apps/console/src/public/site.ts).
const appURLPlaceholder = "%APP_URL%"

// Options is what the pages depend on beyond the built files.
type Options struct {
	AppURL string // the public origin, without a trailing slash

	// PostHogKey, when set, turns on browser analytics: every page carries it,
	// and PostHogHost, as meta tags apps/console/src/lib/analytics.ts reads.
	PostHogKey, PostHogHost string

	// Viewer is who is asking: the signed-in profile's locale ("" for none)
	// and whether anybody is signed in. Nil is nobody.
	Viewer func(r *http.Request) (locale string, signedIn bool)
}

// legalPages are the legal pages a build may hold, by path.
var legalPages = []string{"/privacy", "/terms"}

// robotsDisallow are the paths no crawler is asked to read: the API and every
// signed-in or sign-in screen. The sitemap lists none of them.
var robotsDisallow = []string{"/api/", "/account", "/auth/", "/teams", "/plugin"}

// Handler serves the embedded build.
func Handler(o Options) http.Handler {
	root, _ := fs.Sub(dist, "dist")
	return New(root, o)
}

// New serves the build in root.
func New(root fs.FS, o Options) http.Handler {
	s := &site{root: root, files: http.FileServerFS(root), opts: o, pages: map[string][]byte{}}
	meta := ""
	if o.PostHogKey != "" {
		meta = fmt.Sprintf(`<meta name="posthog-key" content="%s"/>`, html.EscapeString(o.PostHogKey))
		if o.PostHogHost != "" {
			meta += fmt.Sprintf(`<meta name="posthog-host" content="%s"/>`, html.EscapeString(o.PostHogHost))
		}
	}
	page := func(b []byte) []byte {
		b = bytes.ReplaceAll(b, []byte(appURLPlaceholder), []byte(o.AppURL))
		return bytes.Replace(b, []byte("</head>"), []byte(meta+"</head>"), 1)
	}
	if names, err := fs.Glob(root, "public/*.html"); err == nil {
		for _, name := range names {
			if b, err := fs.ReadFile(root, name); err == nil {
				s.pages[path.Base(name)] = page(b)
			}
		}
	}
	if b, err := fs.ReadFile(root, "index.html"); err == nil {
		s.index = page(b)
	}
	s.robots, s.sitemap = s.crawlerFiles()
	return s
}

type site struct {
	root  fs.FS
	files http.Handler
	opts  Options
	pages map[string][]byte // dist/public's pages by file name, ready to send
	index []byte            // the console's index.html, ready to send

	robots, sitemap []byte
}

func (s *site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	clean := path.Clean("/" + r.URL.Path)
	switch clean {
	case "/":
		locale, signedIn := "", false
		if s.opts.Viewer != nil {
			locale, signedIn = s.opts.Viewer(r)
		}
		name := "home." + viewerLocale(r, locale)
		if signedIn {
			name += ".signed-in"
		}
		if b, ok := s.pages[name+".html"]; ok {
			// One address, four pages: a cache must key on what chose this one.
			w.Header().Set("Vary", "Cookie, Accept-Language")
			s.html(w, b)
			return
		}
	case "/privacy", "/terms":
		if b, ok := s.pages[clean[1:]+".html"]; ok {
			s.html(w, b)
		} else {
			http.NotFound(w, r)
		}
		return
	case "/robots.txt":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(s.robots)
		return
	case "/sitemap.xml":
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.Write(s.sitemap)
		return
	case "/opengraph-image.png":
		if _, err := fs.Stat(s.root, "public/opengraph-image.png"); err == nil {
			w.Header().Set("Cache-Control", "public, max-age=3600")
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/public/opengraph-image.png"
			s.files.ServeHTTP(w, r2)
			return
		}
	}
	// A file of the build is served as it is, but never a prerendered page
	// directly: those still hold the placeholder.
	name := strings.TrimPrefix(clean, "/")
	if name != "" && !strings.HasPrefix(name, "public/") {
		if info, err := fs.Stat(s.root, name); err == nil && !info.IsDir() && name != "index.html" {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			s.files.ServeHTTP(w, r)
			return
		}
	}
	if s.index == nil {
		http.Error(w, "The console is not built into this binary (pnpm --filter console build).", http.StatusNotFound)
		return
	}
	s.html(w, s.index)
}

func (s *site) html(w http.ResponseWriter, b []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(b)
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
// Host header, which a stranger can set. The sitemap lists the home page, and
// the legal pages where this build published them.
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

	urls := []string{s.opts.AppURL}
	for _, p := range legalPages {
		if _, ok := s.pages[p[1:]+".html"]; ok {
			urls = append(urls, s.opts.AppURL+p)
		}
	}
	b.Reset()
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, u := range urls {
		fmt.Fprintf(&b, "<url>\n<loc>%s</loc>\n</url>\n", html.EscapeString(u))
	}
	b.WriteString("</urlset>\n")
	return robots, []byte(b.String())
}
