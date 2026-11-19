package pages

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pagefile"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pageversion"
)

// FileView is one file of a version, as a view lists it.
type FileView struct {
	Path        string `json:"path"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// View is a view address and what it serves.
type View struct {
	URL       string     `json:"url"`
	ExpiresAt time.Time  `json:"expiresAt"`
	Files     []FileView `json:"files"`
}

// View mints a view address of version n for a member who may read the page.
func (s *Service) View(ctx context.Context, c Caller, teamID, pageID string, n int) (View, error) {
	if _, err := s.member(ctx, c, teamID); err != nil {
		return View{}, err
	}
	p, err := s.readable(ctx, c.UserID, teamID, pageID)
	if err != nil {
		return View{}, err
	}
	v, err := s.version(ctx, p.ID, n)
	if err != nil {
		return View{}, err
	}
	files, err := s.DB.PageFile.Query().Where(pagefile.VersionID(v.ID)).Order(ent.Asc(pagefile.FieldPath)).All(ctx)
	if err != nil {
		return View{}, err
	}
	token, exp, err := s.Sealer.Seal(auth.PageView, auth.Claims{Sub: c.UserID, Team: teamID, Page: p.ID, Version: n}, auth.PageViewTTL)
	if err != nil {
		return View{}, err
	}
	out := View{URL: s.ContentURL + "/p/" + token + "/", ExpiresAt: exp.UTC(), Files: make([]FileView, len(files))}
	for i, f := range files {
		out.Files[i] = FileView{Path: f.Path, ContentType: f.ContentType, Size: f.Size}
	}
	return out, nil
}

func (s *Service) version(ctx context.Context, pageID string, n int) (*ent.PageVersion, error) {
	v, err := s.DB.PageVersion.Query().Where(pageversion.PageID(pageID), pageversion.Number(n)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound()
	}
	return v, err
}

// cdns are the hosts a page may load scripts, styles, images and fonts from.
const cdns = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com"

// Headers are what every response under /p/ carries (docs/tech/pages.md,
// "The view address"): an opaque origin, nothing but its own files and the
// allowed CDNs, framed by the console alone, and never cached unchecked.
func Headers(h http.Header, appURL string) {
	h.Set("Content-Security-Policy", "sandbox allow-scripts allow-popups allow-forms allow-modals; default-src 'none'; "+
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' "+cdns+"; style-src 'self' 'unsafe-inline' "+cdns+
		"; img-src 'self' data: blob: "+cdns+"; font-src 'self' data: "+cdns+"; connect-src "+cdns+
		"; media-src 'self' data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors "+appURL)
	h.Del("X-Frame-Options") // frame-ancestors decides, and admits the console
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Resource-Policy", "same-site")
	h.Set("X-Robots-Tag", "noindex")
	h.Set("Cache-Control", "private, no-cache")
}

// Serve answers GET /p/{token}/{path}: the file of the version the token
// names, re-checking on every request that its reader still may read it.
// Anything else is a 404 that says nothing.
func (s *Service) Serve(w http.ResponseWriter, r *http.Request, appURL string) {
	Headers(w.Header(), appURL)
	rest := strings.TrimPrefix(r.URL.Path, "/p/")
	token, file, ok := strings.Cut(rest, "/")
	if !ok {
		// Relative paths in the page resolve under the token only with the slash.
		http.Redirect(w, r, "/p/"+token+"/", http.StatusFound)
		return
	}
	f, err := s.file(r.Context(), token, file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	markdown := f.ContentType == "text/markdown; charset=utf-8" && file == ""
	etag := `"` + f.Digest + map[bool]string{true: "-md", false: ""}[markdown] + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body, err := s.Store.OpenObject(r.Context(), f.TeamID, objectKind, f.Digest)
	if err != nil {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}
	defer body.Close()
	if markdown {
		src, err := io.ReadAll(io.LimitReader(body, MaxFileSize))
		if err != nil {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(renderMarkdown(src))
		return
	}
	w.Header().Set("Content-Type", f.ContentType)
	w.Header().Set("Content-Length", fmt.Sprint(f.Size))
	if r.Method == http.MethodHead {
		return
	}
	io.Copy(w, body)
}

// file is the file a view token and path name, if its reader may still read
// it: a member of the team now, admitted by the page's sharing now.
func (s *Service) file(ctx context.Context, token, path string) (*ent.PageFile, error) {
	claims, err := s.Sealer.Open(auth.PageView, token)
	if err != nil || claims.Page == "" || claims.Team == "" {
		return nil, notFound()
	}
	if _, err := s.Team.RequireMembership(ctx, claims.Sub, claims.Team, false); err != nil {
		return nil, notFound()
	}
	p, err := s.readable(ctx, claims.Sub, claims.Team, claims.Page)
	if err != nil {
		return nil, err
	}
	v, err := s.version(ctx, p.ID, claims.Version)
	if err != nil {
		return nil, err
	}
	if path == "" {
		path = entries[string(p.Kind)]
	} else if !validPath(path) {
		return nil, notFound()
	}
	f, err := s.DB.PageFile.Query().Where(pagefile.VersionID(v.ID), pagefile.Path(path)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound()
	}
	return f, err
}

var md = goldmark.New(goldmark.WithExtensions(extension.GFM))

// renderMarkdown is a Markdown page as one HTML document. Raw HTML in the
// source is escaped (goldmark's default); the page is sandboxed regardless.
func renderMarkdown(src []byte) []byte {
	var body bytes.Buffer
	if err := md.Convert(src, &body); err != nil {
		body.Reset()
		body.WriteString("<pre>" + html.EscapeString(string(src)) + "</pre>")
	}
	var out bytes.Buffer
	out.WriteString(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
		`body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:46rem;margin:0 auto;padding:2rem 1rem;color:#1f2330;background:#fff}` +
		`pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}pre{background:#f4f5f8;padding:1rem;overflow:auto;border-radius:8px}` +
		`table{border-collapse:collapse}td,th{border:1px solid #d9dce3;padding:.3rem .6rem}img{max-width:100%}` +
		`@media(prefers-color-scheme:dark){body{background:#14161c;color:#e6e8ee}pre{background:#1f222b}td,th{border-color:#353a47}}` +
		`</style></head><body>`)
	out.Write(body.Bytes())
	out.WriteString(`</body></html>`)
	return out.Bytes()
}
