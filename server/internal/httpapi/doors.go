package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// sendCode emails a sign-in code, where the instance sends email.
func (s *Server) sendCode(w http.ResponseWriter, r *http.Request) error {
	if s.Config.Passwords() || s.Mailer == nil {
		return &auth.Refusal{Code: wire.NotAllowed}
	}
	var in struct {
		Email string `json:"email"`
	}
	if err := decode(r, &in); err != nil {
		return &auth.Refusal{Code: wire.InvalidEmail}
	}
	email, ok := wire.Email(in.Email)
	if !ok {
		return &auth.Refusal{Code: wire.InvalidEmail}
	}
	code, err := s.Auth.IssueCode(r.Context(), email)
	if err != nil {
		return err
	}
	if err := s.Mailer.SendCode(r.Context(), email, code); err != nil {
		// The server's reply, never the message: it carries the code.
		slog.Error("SMTP refused a sign-in code", "error", err)
		return &auth.Refusal{Code: wire.Unavailable}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// verifyCode signs in with an emailed code, making the account on its owner's
// first sign-in.
func (s *Server) verifyCode(w http.ResponseWriter, r *http.Request) error {
	if s.Config.Passwords() {
		return &auth.Refusal{Code: wire.NotAllowed}
	}
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := decode(r, &in); err != nil {
		return &auth.Refusal{Code: wire.InvalidCode}
	}
	email, ok := wire.Email(in.Email)
	if !ok || !wire.SixDigits.MatchString(in.Code) {
		return &auth.Refusal{Code: wire.InvalidCode}
	}
	if err := s.Auth.ConsumeCode(r.Context(), email, in.Code); err != nil {
		return err
	}
	user, created, err := auth.Account(r.Context(), s.Auth.DB, auth.EmailProof(email))
	if err != nil {
		return err
	}
	if created {
		s.Analytics.Capture(user.ID, "user_signed_up", map[string]any{"via": "email", "client": "web"})
	}
	if err := s.startSession(w, user, "email"); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

const oauthCookie = "dsh-teamwork-oauth"

// oauthTTL is how long a round trip to Google may take.
const oauthTTL = 10 * time.Minute

func (s *Server) signInFailed(w http.ResponseWriter, r *http.Request, code string) error {
	http.Redirect(w, r, "/sign-in?error="+code, http.StatusFound)
	return nil
}

// startGoogle sends the browser to Google, remembering in a sealed cookie the
// state it must come back with and where to go after.
func (s *Server) startGoogle(w http.ResponseWriter, r *http.Request) error {
	if s.Google == nil {
		return s.signInFailed(w, r, wire.NotAllowed)
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	state := base64.RawURLEncoding.EncodeToString(raw)
	next := wire.ReturnPath(r.URL.Query().Get("next"), "/teams")
	sealed, _, err := s.Auth.Sealer.Seal(auth.OAuthState, auth.Claims{Sub: state, Next: next}, oauthTTL)
	if err != nil {
		return err
	}
	to, err := s.Google.AuthURL(state)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: sealed, Path: "/api/auth/", MaxAge: int(oauthTTL.Seconds()), HttpOnly: true, Secure: s.secure(), SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, to, http.StatusFound)
	return nil
}

// googleCallback is where Google returns: the state must be the one this
// browser was sent with, and Google must have verified the email.
func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) error {
	if s.Google == nil {
		return s.signInFailed(w, r, wire.NotAllowed)
	}
	q := r.URL.Query()
	c, err := r.Cookie(oauthCookie)
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: "", Path: "/api/auth/", MaxAge: -1, HttpOnly: true, Secure: s.secure(), SameSite: http.SameSiteLaxMode})
	if err != nil || q.Get("state") == "" {
		return s.signInFailed(w, r, wire.Unavailable)
	}
	claims, err := s.Auth.Sealer.Open(auth.OAuthState, c.Value)
	if err != nil || claims.Sub != q.Get("state") {
		return s.signInFailed(w, r, wire.Unavailable)
	}
	if q.Get("error") != "" || q.Get("code") == "" {
		return s.signInFailed(w, r, wire.Unavailable)
	}
	proof, err := s.Google.Proof(r.Context(), url.Values{"code": {q.Get("code")}})
	if auth.IsUnverified(err) {
		return s.signInFailed(w, r, wire.NotAllowed)
	}
	if err != nil {
		slog.Error("Google sign-in failed", "error", err)
		return s.signInFailed(w, r, wire.Unavailable)
	}
	user, created, err := auth.Account(r.Context(), s.Auth.DB, proof)
	if err != nil {
		return err
	}
	if created {
		s.Analytics.Capture(user.ID, "user_signed_up", map[string]any{"via": "google", "client": "web"})
	}
	if err := s.startSession(w, user, "google"); err != nil {
		return err
	}
	http.Redirect(w, r, wire.ReturnPath(claims.Next, "/teams"), http.StatusFound)
	return nil
}
