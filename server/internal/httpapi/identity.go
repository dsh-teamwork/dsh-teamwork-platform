package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// caller is who a request is from.
type caller struct {
	user   *ent.User
	via    string
	bearer bool // the plugin's token, rather than the browser's cookie
	issued time.Time
	// team is set for a computer token (ADR 0038) or a host token
	// (ADR 0042): its caller reaches that one team, and only through
	// requirePlugin's routes.
	team string
	// host is a host token's shared DSH. Such a caller is no person: user is
	// nil, and team is set.
	host string
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
	return &caller{user: user, via: claims.Via, bearer: bearer, issued: time.Unix(claims.Iat, 0)}, nil
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

// requirePlugin is requireUser for the two routes a DSH plugin needs, the
// configuration it syncs and the model gateway, which also accept a computer
// token (ADR 0038) and a host token (ADR 0042). Every other route calls
// requireUser, where neither opens.
func (s *Server) requirePlugin(r *http.Request) (*caller, error) {
	token := bearerToken(r.Header.Get("Authorization"))
	if token == "" {
		return s.requireUser(r)
	}
	if _, err := s.Auth.Sealer.Open(auth.PluginBearer, token); err == nil {
		return s.requireUser(r)
	}
	if claims, err := s.Auth.Sealer.Open(auth.HostBearer, token); err == nil {
		if claims.Team == "" {
			return nil, errUnauthorized
		}
		return &caller{via: claims.Via, bearer: true, team: claims.Team, host: claims.Sub}, nil
	}
	claims, err := s.Auth.Sealer.Open(auth.ComputerBearer, token)
	if err != nil || claims.Team == "" {
		return nil, errUnauthorized
	}
	user, err := s.Auth.DB.User.Get(r.Context(), claims.Sub)
	if ent.IsNotFound(err) {
		return nil, errUnauthorized
	}
	if err != nil {
		return nil, err
	}
	return &caller{user: user, via: claims.Via, bearer: true, team: claims.Team}, nil
}

// MintComputerToken seals a computer token for a member of a team, for a host
// such as an edition's dispatcher. Membership is re-read on every request it
// makes, as for a plugin token.
func (s *Server) MintComputerToken(ctx context.Context, userID, teamID, host string, ttl time.Duration) (string, time.Time, error) {
	if userID == "" || teamID == "" || host == "" || len(host) > 64 || ttl <= 0 || ttl > auth.ComputerTTL {
		return "", time.Time{}, errors.New("invalid computer token request")
	}
	in, err := s.Auth.DB.Membership.Query().Where(membership.UserID(userID), membership.TeamID(teamID)).Exist(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	if !in {
		return "", time.Time{}, errors.New("a computer token for a team its member is not in")
	}
	return s.Auth.Sealer.Seal(auth.ComputerBearer, auth.Claims{Sub: userID, Via: "computer", Team: teamID, Host: host}, ttl)
}

// MintHostToken seals a host token for a shared DSH of a team (ADR 0042).
// Only an edition mints one, after checking the shared host is the team's and
// not revoked; the team must exist.
func (s *Server) MintHostToken(ctx context.Context, hostID, teamID string, ttl time.Duration) (string, time.Time, error) {
	if hostID == "" || len(hostID) > 64 || teamID == "" || ttl <= 0 || ttl > auth.HostTTL {
		return "", time.Time{}, errors.New("invalid host token request")
	}
	exists, err := s.Auth.DB.Team.Query().Where(team.ID(teamID)).Exist(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	if !exists {
		return "", time.Time{}, errors.New("a host token for a team that does not exist")
	}
	return s.Auth.Sealer.Seal(auth.HostBearer, auth.Claims{Sub: hostID, Via: "host", Team: teamID}, ttl)
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
