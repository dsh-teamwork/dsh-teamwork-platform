package httpapi

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/pages"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// pageCaller is who a pages route answers: a member.
func pageCaller(c *caller) pages.Caller {
	return pages.Caller{UserID: c.user.ID, TeamID: c.team}
}

func (s *Server) createPage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	out, err := s.Pages.Create(r.Context(), pageCaller(c), r.PathValue("teamId"), r)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *Server) addPageVersion(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	out, err := s.Pages.AddVersion(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id"), r)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *Server) listPages(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	out, err := s.Pages.List(r.Context(), pageCaller(c), r.PathValue("teamId"), q.Get("list"), q.Get("before"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, out)
	return nil
}

func (s *Server) getPage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	out, err := s.Pages.Get(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, out)
	return nil
}

// viewPage mints a view address for a person: the console, the app or a
// member's plugin.
func (s *Server) viewPage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	who := pageCaller(c)
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		return wire.E(http.StatusNotFound, "page_not_found")
	}
	out, err := s.Pages.View(r.Context(), who, r.PathValue("teamId"), r.PathValue("id"), n)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, out)
	return nil
}

// contentHost sends a request for CONTENT_URL's host, where it is not
// APP_URL's, to the pages alone (docs/tech/pages.md, "The view address"):
// /p/, a robots.txt refusing every crawler, and 404 for anything else. It
// is the host the server listens as, not one a request may name freely: any
// other host goes on to the site, which serves no page.
func (s *Server) contentHost(next http.Handler) http.Handler {
	content, app := s.Config.ContentURL, s.Config.AppURL
	if s.Pages == nil || content == "" || content == app {
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
		case (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/p/"):
			s.Pages.Serve(w, r, app)
		case r.Method == http.MethodGet && r.URL.Path == "/robots.txt":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Write([]byte("User-agent: *\nDisallow: /\n"))
		default:
			pages.Headers(w.Header(), app)
			http.NotFound(w, r)
		}
	})
}

// sitePages is /p/ on APP_URL's host: the pages themselves where CONTENT_URL
// is APP_URL, and a 404 where they have a host of their own.
func (s *Server) sitePages(w http.ResponseWriter, r *http.Request) {
	if s.Config.ContentURL != "" && s.Config.ContentURL != s.Config.AppURL {
		http.NotFound(w, r)
		return
	}
	s.Pages.Serve(w, r, s.Config.AppURL)
}

func (s *Server) renamePage(w http.ResponseWriter, r *http.Request) error {
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
	if err := s.Pages.Rename(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id"), in.Title); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) sharePage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in pages.Sharing
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Pages.SetSharing(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id"), in); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) restorePage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		return wire.E(http.StatusNotFound, "page_not_found")
	}
	out, err := s.Pages.Restore(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id"), n)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusCreated, out)
	return nil
}

func (s *Server) deletePage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Pages.Delete(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
