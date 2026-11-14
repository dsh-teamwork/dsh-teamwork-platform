package httpapi

import (
	"errors"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// SessionView is GET /api/auth/session: who is signed in, if anyone, and the
// doors this instance offers.
type SessionView struct {
	User  *SessionUser `json:"user"`
	Doors struct {
		Password  bool `json:"password"`
		EmailCode bool `json:"emailCode"`
		Google    bool `json:"google"`
	} `json:"doors"`
	SetupOpen            bool   `json:"setupOpen"`
	MobileRedirectPrefix string `json:"mobileRedirectPrefix"`
}

// SessionUser is the signed-in person.
type SessionUser struct {
	ID                 string  `json:"id"`
	Email              *string `json:"email"`
	Name               *string `json:"name"`
	MustChangePassword bool    `json:"mustChangePassword"`
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) error {
	var v SessionView
	v.Doors.Password = s.Config.Passwords()
	v.MobileRedirectPrefix = s.Config.MobileRedirectURI
	c, err := s.identify(r)
	if err != nil {
		return err
	}
	if c != nil && !c.bearer {
		must, err := s.Auth.MustChange(r.Context(), c.user.ID)
		if err != nil {
			return err
		}
		v.User = &SessionUser{ID: c.user.ID, Email: c.user.Email, Name: c.user.Name, MustChangePassword: must}
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
	if err := s.startSession(w, user, "password"); err != nil {
		return err
	}
	must, err := s.Auth.MustChange(r.Context(), user.ID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"mustChangePassword": must})
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
	if err := s.startSession(w, user, "password"); err != nil {
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
	if err := s.Auth.ChangePassword(r.Context(), c.user, in.Current, in.Next); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) signOut(w http.ResponseWriter, r *http.Request) error {
	s.endSession(w)
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
	if c == nil || c.bearer {
		return errUnauthorized
	}
	var in wire.PluginCode
	if err := decode(r, &in); err != nil {
		return err
	}
	var back *wire.ReturnTo
	if in.RedirectURI != "" {
		to, ok := wire.ReturnAddress(in.RedirectURI, s.Config.MobileRedirectURI)
		if !ok {
			return wire.E(http.StatusBadRequest, "invalid_redirect")
		}
		back = &to
	}
	code, err := s.Auth.MintHandoff(r.Context(), c.user, c.via, in.Challenge)
	if err != nil {
		return err
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
	if in.Code == "" || len(in.Verifier) < 43 || len(in.Verifier) > 128 {
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
