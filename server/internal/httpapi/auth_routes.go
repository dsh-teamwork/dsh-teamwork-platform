package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// SessionView is GET /api/auth/session: who is signed in, if anyone, and the
// doors this instance offers.
type SessionView struct {
	AppChallenge        string       `json:"appChallenge,omitempty"`
	PendingVerification bool         `json:"pendingVerification,omitempty"`
	User                *SessionUser `json:"user"`
	Doors               struct {
		Password  bool `json:"password"`
		EmailCode bool `json:"emailCode"`
		Google    bool `json:"google"`
	} `json:"doors"`
	SetupOpen   bool   `json:"setupOpen"`
	AppRedirect string `json:"appRedirect"`
}

// SessionUser is the signed-in person.
type SessionUser struct {
	ID                 string  `json:"id"`
	Email              *string `json:"email"`
	Name               *string `json:"name"`
	MustChangePassword bool    `json:"mustChangePassword"`
	// ChangeWithoutCurrent: this session signed in with the admin-set password,
	// so it replaces it without typing it again (auth.FirstPasswordProven).
	ChangeWithoutCurrent bool `json:"changeWithoutCurrent"`
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) error {
	var v SessionView
	v.Doors.Password = s.Config.Passwords()
	v.Doors.EmailCode = !s.Config.Passwords()
	v.Doors.Google = s.Google != nil
	v.AppRedirect = wire.AppReturn
	if s.SignInGate != nil {
		claims, _ := s.appClaims(r)
		v.AppChallenge = claims.Challenge
		pending, err := s.PendingLogin(r)
		if err != nil {
			return err
		}
		v.PendingVerification = pending != nil
	}
	c, err := s.identify(r)
	if err != nil {
		return err
	}
	if c != nil && !c.bearer {
		must, err := s.Auth.MustChange(r.Context(), c.user.ID)
		if err != nil {
			return err
		}
		proven, err := s.Auth.FirstPasswordProven(r.Context(), c.user.ID, c.via, c.issued)
		if err != nil {
			return err
		}
		v.User = &SessionUser{ID: c.user.ID, Email: c.user.Email, Name: c.user.Name, MustChangePassword: must, ChangeWithoutCurrent: proven}
	}
	if v.Doors.Password {
		if v.SetupOpen, err = s.Auth.SetupOpen(r.Context()); err != nil {
			return err
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) passwordsOnly() error {
	if !s.Config.Passwords() {
		return &auth.Refusal{Code: wire.NotAllowed}
	}
	return nil
}

func (s *Server) passwordSignIn(w http.ResponseWriter, r *http.Request) error {
	if err := s.passwordsOnly(); err != nil {
		return err
	}
	var in wire.PasswordSignIn
	if err := decode(r, &in); err != nil {
		return &auth.Refusal{Code: wire.InvalidCredentials}
	}
	if _, ok := wire.Email(in.Email); !ok || in.Password == "" || len(in.Password) > 1024 {
		return &auth.Refusal{Code: wire.InvalidCredentials}
	}
	user, err := s.Auth.CheckPassword(r.Context(), in.Email, in.Password)
	if err != nil {
		return err
	}
	if err := s.startSession(w, r, user, "password"); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"mustChangePassword": user.Edges.Password.MustChange})
	return nil
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) error {
	if err := s.passwordsOnly(); err != nil {
		return err
	}
	var in wire.Setup
	if err := decode(r, &in); err != nil {
		return err
	}
	user, err := s.Auth.ClaimFirstAccount(r.Context(), in.Token, in.Email, in.Password)
	if err != nil {
		return err
	}
	if err := s.startSession(w, r, user, "password"); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) error {
	if err := s.passwordsOnly(); err != nil {
		return err
	}
	c, err := s.identify(r)
	if err != nil {
		return err
	}
	if c == nil || c.bearer {
		return errUnauthorized
	}
	var in wire.ChangePassword
	if err := decode(r, &in); err != nil {
		return err
	}
	proven, err := s.Auth.FirstPasswordProven(r.Context(), c.user.ID, c.via, c.issued)
	if err != nil {
		return err
	}
	if err := s.Auth.ChangePassword(r.Context(), c.user, in.Current, in.Next, proven); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) signOut(w http.ResponseWriter, r *http.Request) error {
	s.clearPending(w)
	s.endSession(w)
	if len(s.SignOutHandlers) > 0 {
		var who *edition.Identity
		var err error
		if r.Header.Get("Authorization") != "" {
			who, err = s.BearerIdentity(r.Context(), bearerToken(r.Header.Get("Authorization")))
		} else if c, cookieErr := r.Cookie(s.cookieName()); cookieErr == nil {
			who, err = s.open(r.Context(), auth.Session, c.Value)
		}
		if err != nil {
			slog.Error("sign-out identity lookup failed", "error", err)
		}
		if who != nil {
			for _, f := range s.SignOutHandlers {
				if err := f(r.Context(), who); err != nil {
					slog.Error("sign-out grant cleanup failed", "error", err)
				}
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// pluginCode is the confirmation on /plugin: a signed-in person, in the
// browser, asks for a code bound to the plugin's challenge. A link alone
// mints nothing; a Bearer token cannot mint another.
func (s *Server) pluginCode(w http.ResponseWriter, r *http.Request) error {
	c, err := s.identify(r)
	if err != nil {
		return err
	}
	if r.Header.Get("Authorization") != "" {
		return errUnauthorized
	}
	var in wire.PluginCode
	if err := decode(r, &in); err != nil {
		return err
	}
	var back *wire.ReturnTo
	if in.RedirectURI != "" {
		to, ok := wire.ReturnAddress(in.RedirectURI)
		if !ok {
			return wire.E(http.StatusBadRequest, "invalid_redirect")
		}
		back = &to
	}
	if s.SignInGate != nil && back != nil && back.To == "app" {
		who, err := s.AppLoginIdentity(r, in.Challenge)
		if err != nil {
			return err
		}
		if who == nil {
			return errUnauthorized
		}
		user, err := s.Auth.DB.User.Get(r.Context(), who.UserID)
		if err != nil {
			return err
		}
		c = &caller{user: user, via: who.Via}
		required, err := s.SignInGate.Required(r.Context(), who.UserID)
		if err != nil {
			return err
		}
		if required {
			ok, err := s.SignInGate.ConsumeAppProof(r.Context(), who.UserID, who.SessionID, in.Challenge)
			if err != nil {
				return err
			}
			if !ok {
				return wire.E(http.StatusForbidden, "verification_required")
			}
		}
	}
	if c == nil || c.bearer {
		return errUnauthorized
	}
	code, err := s.Auth.MintHandoff(r.Context(), c.user, c.via, in.Challenge)
	if err != nil {
		return err
	}
	if back != nil && back.To == "app" {
		s.clearPending(w)
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": code, "returnTo": back})
	return nil
}

// pluginToken is the plugin's exchange: code and verifier for a Bearer token.
func (s *Server) pluginToken(w http.ResponseWriter, r *http.Request) error {
	var in wire.PluginToken
	if err := decode(r, &in); err != nil {
		return wire.E(http.StatusBadRequest, "invalid_request")
	}
	if in.Code == "" || !wire.ValidVerifier(in.Verifier) {
		return wire.E(http.StatusBadRequest, "invalid_request")
	}
	token, exp, err := s.Auth.RedeemHandoff(r.Context(), in.Code, in.Verifier)
	if errors.Is(err, auth.ErrInvalidCode) {
		return wire.E(http.StatusUnauthorized, wire.InvalidCode)
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "expiresAt": team.Time(exp)})
	return nil
}

// revokePluginToken is signing out of a plugin or the app: the Bearer sent
// opens nothing from now on (ADR 0060). It answers 204 whether or not the
// token still opened, so it tells a caller nothing about one.
func (s *Server) revokePluginToken(w http.ResponseWriter, r *http.Request) error {
	if err := s.Auth.RevokeBearer(r.Context(), bearerToken(r.Header.Get("Authorization"))); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
