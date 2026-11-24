package artifacts

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactfile"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactversion"
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

// View mints a view address of version n for a member who may read the artifact.
func (s *Service) View(ctx context.Context, c Caller, teamID, artifactID string, n int) (View, error) {
	if _, err := s.member(ctx, c, teamID); err != nil {
		return View{}, err
	}
	p, err := s.readable(ctx, c.UserID, teamID, artifactID)
	if err != nil {
		return View{}, err
	}
	v, err := s.version(ctx, p.ID, n)
	if err != nil {
		return View{}, err
	}
	files, err := s.DB.ArtifactFile.Query().Where(artifactfile.VersionID(v.ID)).Order(ent.Asc(artifactfile.FieldPath)).All(ctx)
	if err != nil {
		return View{}, err
	}
	token, exp, err := s.Sealer.Seal(auth.ArtifactView, auth.Claims{Sub: c.UserID, Team: teamID, Artifact: p.ID, Version: n}, auth.ArtifactViewTTL)
	if err != nil {
		return View{}, err
	}
	out := View{URL: s.ContentURL + "/a/" + token + "/", ExpiresAt: exp.UTC(), Files: make([]FileView, len(files))}
	for i, f := range files {
		out.Files[i] = FileView{Path: f.Path, ContentType: f.ContentType, Size: f.Size}
	}
	return out, nil
}

func (s *Service) version(ctx context.Context, artifactID string, n int) (*ent.ArtifactVersion, error) {
	v, err := s.DB.ArtifactVersion.Query().Where(artifactversion.ArtifactID(artifactID), artifactversion.Number(n)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound()
	}
	return v, err
}

// cdns are the hosts an artifact may load scripts, styles, images and fonts from.
const cdns = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com"

// Headers are what every response under /a/ carries (docs/tech/artifacts.md,
// "The view address"): an opaque origin, nothing but its own files and the
// allowed CDNs, framed by the console alone, and never cached unchecked.
func Headers(h http.Header, appURL string) {
	h.Set("Content-Security-Policy", "sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads; default-src 'none'; "+
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' "+cdns+"; style-src 'self' 'unsafe-inline' "+cdns+
		"; img-src 'self' data: blob: "+cdns+"; font-src 'self' data: "+cdns+"; connect-src "+cdns+
		"; media-src 'self' data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors "+appURL)
	h.Del("X-Frame-Options") // frame-ancestors decides, and admits the console
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	// cross-origin, not same-site: the sandbox gives the artifact an opaque origin, so its own files are another
	// site's to the browser, and same-site would block all but the entry. The address is the capability.
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	h.Set("X-Robots-Tag", "noindex")
	h.Set("Cache-Control", "private, no-cache")
}

// Serve answers GET /a/{token}/{path}: the file of the version the token
// names, re-checking on every request that its reader still may read it.
// Anything else is a 404 that says nothing.
func (s *Service) Serve(w http.ResponseWriter, r *http.Request, appURL string) {
	Headers(w.Header(), appURL)
	rest := strings.TrimPrefix(r.URL.Path, "/a/")
	token, file, ok := strings.Cut(rest, "/")
	if !ok {
		// Relative paths in the artifact resolve under the token only with the slash.
		http.Redirect(w, r, "/a/"+token+"/", http.StatusFound)
		return
	}
	f, err := s.file(r.Context(), token, file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	etag := `"` + f.Digest + `"`
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
	w.Header().Set("Content-Type", f.ContentType)
	w.Header().Set("Content-Length", fmt.Sprint(f.Size))
	if r.Method == http.MethodHead {
		return
	}
	io.Copy(w, body)
}

// file is the file a view token and path name, if its reader may still read
// it: a member of the team now, admitted by the artifact's sharing now.
func (s *Service) file(ctx context.Context, token, path string) (*ent.ArtifactFile, error) {
	claims, err := s.Sealer.Open(auth.ArtifactView, token)
	if err != nil || claims.Artifact == "" || claims.Team == "" {
		return nil, notFound()
	}
	if _, err := s.Team.RequireMembership(ctx, claims.Sub, claims.Team, false); err != nil {
		return nil, notFound()
	}
	p, err := s.readable(ctx, claims.Sub, claims.Team, claims.Artifact)
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
	f, err := s.DB.ArtifactFile.Query().Where(artifactfile.VersionID(v.ID), artifactfile.Path(path)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound()
	}
	return f, err
}
