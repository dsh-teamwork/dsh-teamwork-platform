package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// localeCookieAge is how long a chosen language is remembered: a year.
const localeCookieAge = 365 * 24 * time.Hour

// chooseLocale is the language picker's one write. The cookie is written for
// everybody, so a choice made while signed out survives signing in; a
// signed-in choice also goes on the profile, so it follows the account to
// another browser. The console reads the cookie, so it is not HttpOnly.
func (s *Server) chooseLocale(w http.ResponseWriter, r *http.Request) error {
	var in wire.ChooseLocale
	if err := decode(r, &in); err != nil {
		return err
	}
	c, err := s.identify(r)
	if err != nil {
		return err
	}
	if c != nil {
		if err := c.user.Update().SetLocale(in.Locale).Exec(r.Context()); err != nil {
			return err
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name: web.LocaleCookie, Value: in.Locale, Path: "/",
		Expires: time.Now().Add(localeCookieAge), MaxAge: int(localeCookieAge.Seconds()),
		Secure: s.secure(), SameSite: http.SameSiteLaxMode,
	})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Viewer is who a public page is for (web.Options.Viewer): the signed-in
// profile's locale, and whether anybody is signed in. A database that cannot
// say is logged, and the page is the signed-out one.
func (s *Server) Viewer(r *http.Request) (locale string, signedIn bool) {
	c, err := s.identify(r)
	if err != nil {
		slog.Error("could not read the session for a public page", "path", r.URL.Path, "error", err)
		return "", false
	}
	if c == nil {
		return "", false
	}
	if c.user.Locale != nil {
		locale = *c.user.Locale
	}
	return locale, true
}
