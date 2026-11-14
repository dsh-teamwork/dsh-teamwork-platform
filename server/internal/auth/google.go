package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/google"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// GoogleCallbackPath is where Google returns to: the path the Node server's
// Auth.js used, so an OAuth client registered for it keeps working.
const GoogleCallbackPath = "/api/auth/callback/google"

// Google is the Google door, through goth (ADR 0014). It is a door only where
// AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set.
type Google struct {
	provider *google.Provider
}

// NewGoogle is the door for an OAuth client; client is the HTTP client for
// Google's endpoints, http.DefaultClient's transport when nil.
func NewGoogle(clientID, secret, appURL string, client *http.Client) *Google {
	p := google.New(clientID, secret, appURL+GoogleCallbackPath, "openid", "email", "profile")
	p.HTTPClient = client
	p.SetPrompt("select_account")
	return &Google{provider: p}
}

// AuthURL is where to send the browser, carrying state.
func (g *Google) AuthURL(state string) (string, error) {
	sess, err := g.provider.BeginAuth(state)
	if err != nil {
		return "", err
	}
	return sess.GetAuthURL()
}

// errUnverified is a Google account whose email Google has not verified: it
// would let anybody claim an account by email alone.
var errUnverified = errors.New("google: email not verified")

// Proof trades the code Google returned for what it proves: its user id, and
// the email it verified. An unverified email signs nobody in.
func (g *Google) Proof(ctx context.Context, query url.Values) (Proof, error) {
	sess := &google.Session{}
	if _, err := sess.Authorize(g.provider, goth.Params(query)); err != nil {
		return Proof{}, err
	}
	u, err := g.provider.FetchUser(sess)
	if err != nil {
		return Proof{}, err
	}
	verified, _ := u.RawData["verified_email"].(bool)
	email, ok := wire.Email(u.Email)
	if !verified || !ok || u.UserID == "" {
		return Proof{}, errUnverified
	}
	p := Proof{Provider: "google", Subject: u.UserID, Email: &email}
	if u.Name != "" {
		p.Name = &u.Name
	}
	if u.AvatarURL != "" {
		p.Image = &u.AvatarURL
	}
	return p, nil
}

// IsUnverified is whether err is a Google account with no verified email.
func IsUnverified(err error) bool { return errors.Is(err, errUnverified) }
