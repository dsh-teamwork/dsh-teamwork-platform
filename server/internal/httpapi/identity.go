package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// caller is who a request is from.
type caller struct {
	user   *ent.User
	via    string
	bearer bool // the plugin's token, rather than the browser's cookie
}

// bearerToken is the token in `Authorization: Bearer …`, or "".
func bearerToken(h string) string {
	parts := strings.Fields(h)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return parts[1]
}

func (s *Server) cookieName() string {
	if s.secure() {
		return "__Secure-dsh-teamwork-session"
	}
	return "dsh-teamwork-session"
}

func (s *Server) secure() bool { return strings.HasPrefix(s.Config.AppURL, "https://") }

// identify is the caller, or nil: the plugin's Bearer token first, the
// browser's session cookie second. A Bearer that does not open is nobody,
// never a reason to read the cookie instead.
func (s *Server) identify(r *http.Request) (*caller, error) {
	purpose, token, bearer := auth.Session, "", false
	if h := r.Header.Get("Authorization"); h != "" {
		purpose, token, bearer = auth.PluginBearer, bearerToken(h), true
	} else if c, err := r.Cookie(s.cookieName()); err == nil {
		token = c.Value
	}
	if token == "" {
		return nil, nil
	}
	claims, err := s.Auth.Sealer.Open(purpose, token)
	if err != nil {
		return nil, nil
	}
	user, err := s.Auth.DB.User.Get(r.Context(), claims.Sub)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &caller{user: user, via: claims.Via, bearer: bearer}, nil
}

// requireUser is the caller, or 401. A browser session whose admin-set
// password is still unchanged reaches nothing but sign-in until it is.
func (s *Server) requireUser(r *http.Request) (*caller, error) {
	c, err := s.identify(r)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, errUnauthorized
	}
	if !c.bearer {
		must, err := s.Auth.MustChange(r.Context(), c.user.ID)
		if err != nil {
			return nil, err
		}
		if must {
			return nil, wire.E(http.StatusForbidden, wire.PasswordChangeRequired)
		}
	}
	return c, nil
}

// sameOrigin guards a write a browser could be tricked into sending: one the
// session cookie would authorize, or a sign-in. It must come from this site.
// A request carrying a Bearer token is the plugin's, which no other site can
// make a browser send.
func (s *Server) sameOrigin(r *http.Request) bool {
	if r.Header.Get("Authorization") != "" {
		return true
	}
	if o := r.Header.Get("Origin"); o != "" {
		got, err1 := url.Parse(o)
		want, err2 := url.Parse(s.Config.AppURL)
		if err1 != nil || err2 != nil || got.Scheme != want.Scheme || got.Port() != want.Port() {
			return false
		}
		// localhost, 127.0.0.1 and [::1] are one machine: a server on loopback
		// is the same site whichever name the browser used. Any other host
		// must be APP_URL's own, which DNS rebinding cannot fake.
		return got.Hostname() == want.Hostname() || (loopback(got.Hostname()) && loopback(want.Hostname()))
	}
	return r.Header.Get("Sec-Fetch-Site") == "same-origin"
}

func loopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// startSession sets the browser's session cookie.
func (s *Server) startSession(w http.ResponseWriter, user *ent.User, via string) error {
	token, exp, err := s.Auth.Sealer.Seal(auth.Session, auth.Claims{Sub: user.ID, Via: via}, auth.SessionTTL)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: s.cookieName(), Value: token, Path: "/", Expires: exp, MaxAge: int(time.Until(exp).Seconds()),
		HttpOnly: true, Secure: s.secure(), SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func (s *Server) endSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: s.cookieName(), Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.secure(), SameSite: http.SameSiteLaxMode,
	})
}

// The caller as a closed edition sees it (server/edition).

// SessionIdentity is the browser's session on r, or nil; a Bearer token is
// not looked at.
func (s *Server) SessionIdentity(r *http.Request) (*edition.Identity, error) {
	c, err := r.Cookie(s.cookieName())
	if err != nil || c.Value == "" {
		return nil, nil
	}
	return s.open(r.Context(), auth.Session, c.Value)
}

// BearerIdentity opens a token the plugin or the app holds, or is nil.
func (s *Server) BearerIdentity(ctx context.Context, token string) (*edition.Identity, error) {
	if token == "" {
		return nil, nil
	}
	return s.open(ctx, auth.PluginBearer, token)
}

// SameOrigin reports whether r, a write, came from this site.
func (s *Server) SameOrigin(r *http.Request) bool { return s.sameOrigin(r) }

func (s *Server) open(ctx context.Context, purpose auth.Purpose, token string) (*edition.Identity, error) {
	claims, err := s.Auth.Sealer.Open(purpose, token)
	if err != nil {
		return nil, nil
	}
	user, err := s.Auth.DB.User.Get(ctx, claims.Sub)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	id := &edition.Identity{UserID: user.ID, Via: claims.Via}
	if user.Email != nil {
		id.Email = *user.Email
	}
	return id, nil
}
