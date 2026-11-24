package httpapi

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifacts"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// artifactCaller is who an artifacts route answers: a member.
func artifactCaller(c *caller) artifacts.Caller {
	return artifacts.Caller{UserID: c.user.ID, TeamID: c.team}
}

func (s *Server) createArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	out, err := s.Artifacts.Create(r.Context(), artifactCaller(c), r.PathValue("teamId"), r)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *Server) addArtifactVersion(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	out, err := s.Artifacts.AddVersion(r.Context(), artifactCaller(c), r.PathValue("teamId"), r.PathValue("id"), r)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *Server) listArtifacts(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	out, err := s.Artifacts.List(r.Context(), artifactCaller(c), r.PathValue("teamId"), q.Get("list"), q.Get("before"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *Server) getArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	out, err := s.Artifacts.Get(r.Context(), artifactCaller(c), r.PathValue("teamId"), r.PathValue("id"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, out)
	return nil
}

// viewArtifact mints a view address for a person: the console, the app or a
// member's plugin.
func (s *Server) viewArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	who := artifactCaller(c)
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		return wire.E(http.StatusNotFound, "artifact_not_found")
	}
	out, err := s.Artifacts.View(r.Context(), who, r.PathValue("teamId"), r.PathValue("id"), n)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, out)
	return nil
}

// contentHost sends a request for CONTENT_URL's host, where it is not
// APP_URL's, to the artifacts alone (docs/tech/artifacts.md, "The view address"):
// /a/, a robots.txt refusing every crawler, and 404 for anything else. It
// is the host the server listens as, not one a request may name freely: any
// other host goes on to the site, which serves no artifact.
func (s *Server) contentHost(next http.Handler) http.Handler {
	content, app := s.Config.ContentURL, s.Config.AppURL
	if s.Artifacts == nil || content == "" || content == app {
		return next
	}
	u, err := url.Parse(content)
	if err != nil {
		return next
	}
	host := u.Host
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Host, host) {
			next.ServeHTTP(w, r)
			return
		}
		switch {
		case (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/a/"):
			s.Artifacts.Serve(w, r, app)
		case r.Method == http.MethodGet && r.URL.Path == "/robots.txt":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte("User-agent: *\nDisallow: /\n"))
		default:
			artifacts.Headers(w.Header(), app)
			http.NotFound(w, r)
		}
	})
}

// siteArtifacts is /a/ on APP_URL's host: the artifacts themselves where CONTENT_URL
// is APP_URL, and a 404 where they have a host of their own.
func (s *Server) siteArtifacts(w http.ResponseWriter, r *http.Request) {
	if s.Config.ContentURL != "" && s.Config.ContentURL != s.Config.AppURL {
		http.NotFound(w, r)
		return
	}
	s.Artifacts.Serve(w, r, s.Config.AppURL)
}

func (s *Server) renameArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in struct {
		Title string `json:"title"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Artifacts.Rename(r.Context(), artifactCaller(c), r.PathValue("teamId"), r.PathValue("id"), in.Title); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) shareArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in artifacts.Sharing
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Artifacts.SetSharing(r.Context(), artifactCaller(c), r.PathValue("teamId"), r.PathValue("id"), in); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) restoreArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		return wire.E(http.StatusNotFound, "artifact_not_found")
	}
	out, err := s.Artifacts.Restore(r.Context(), artifactCaller(c), r.PathValue("teamId"), r.PathValue("id"), n)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *Server) deleteArtifact(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Artifacts.Delete(r.Context(), artifactCaller(c), r.PathValue("teamId"), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
