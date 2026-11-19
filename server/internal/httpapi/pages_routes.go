package httpapi

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/pages"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// pageCaller is who a pages route answers: a member, or a Team DSH acting for
// the starter it names (the upload says who).
func pageCaller(c *caller) pages.Caller {
	out := pages.Caller{HostID: c.host, TeamID: c.team}
	if c.user != nil {
		out.UserID = c.user.ID
	}
	return out
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

// viewPage mints a view address for a person: the console, the app, or a
// member's plugin; a Team DSH, which is no person, gets none.
func (s *Server) viewPage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requirePlugin(r)
	if err != nil {
		return err
	}
	if c.user == nil {
		return wire.E(http.StatusNotFound, "page_not_found")
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil || n < 1 {
		return wire.E(http.StatusNotFound, "page_not_found")
	}
	out, err := s.Pages.View(r.Context(), pageCaller(c), r.PathValue("teamId"), r.PathValue("id"), n)
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
