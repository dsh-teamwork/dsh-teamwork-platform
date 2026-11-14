package httpapi

import (
	"net/http"
	"net/url"
	"strings"
	"time"

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
		want, err := url.Parse(s.Config.AppURL)
		return err == nil && o == want.Scheme+"://"+want.Host
	}
	return r.Header.Get("Sec-Fetch-Site") == "same-origin"
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
