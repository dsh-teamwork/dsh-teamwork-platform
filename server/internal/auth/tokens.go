package auth

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"golang.org/x/crypto/hkdf"
)

// Purpose separates what a sealed value is for: each has its own key, so a
// hand-off code is not a session and a cookie is not a Bearer token.
type Purpose string

const (
	PendingLogin  Purpose = "dsh-teamwork.pending-login"
	AppLogin      Purpose = "dsh-teamwork.app-login"
	Session       Purpose = "dsh-teamwork.session"
	PluginHandoff Purpose = "dsh-teamwork.plugin-handoff"
	PluginBearer  Purpose = "dsh-teamwork.plugin-session"
	OAuthState    Purpose = "dsh-teamwork.oauth-state"
	// ComputerBearer is the token a host gives the plugin in a cloud computer
	// (ADR 0038): one member, one team, at most ComputerTTL, and accepted only
	// by GET /api/configs and the model gateway.
	ComputerBearer Purpose = "dsh-teamwork.computer"
	// HostBearer is the token a shared DSH holds (ADR 0047): one shared host,
	// no person, one team, at most HostTTL, and accepted only by
	// GET /api/configs and the model gateway.
	HostBearer Purpose = "dsh-teamwork.host"
	// PageView is a page's view address (docs/tech/pages.md, "The view
	// address"): one reader, one version of one page, at most PageViewTTL. It
	// opens nothing but the files that version serves under /p/.
	PageView Purpose = "dsh-teamwork.page-view"
)

// ComputerTTL is the longest a computer token lives; its host renews it.
const ComputerTTL = time.Hour

// HostTTL is the longest a host token lives; the shared DSH renews it.
const HostTTL = time.Hour

// PageViewTTL is how long a page's view address lives.
const PageViewTTL = time.Hour

// SessionTTL is how long a browser session lasts. It cannot be revoked before
// it expires — the price of having no session table; team access is still
// re-checked on every request.
const SessionTTL = 30 * 24 * time.Hour

// A plugin's or the app's token names a grant (ADR 0060): it lapses after
// GrantIdle unused, every use moving that on, and no token outlives
// GrantMaxTTL from its sign-in. A use is recorded at most once per grantTouch.
const (
	GrantIdle   = 30 * 24 * time.Hour
	GrantMaxTTL = 365 * 24 * time.Hour
	grantTouch  = time.Hour
)

// HandoffTTL is how long a plugin's sign-in code lives.
const HandoffTTL = 2 * time.Minute

// Claims is what a sealed value carries.
type Claims struct {
	Sub       string `json:"sub"`                 // the user id; a host token's shared host id
	Via       string `json:"via,omitempty"`       // the door: password, email, google, feishu
	Challenge string `json:"challenge,omitempty"` // a hand-off code's PKCE challenge
	Next      string `json:"next,omitempty"`      // an OAuth round trip's return path
	Team      string `json:"team,omitempty"`      // a computer or host token's one team
	Host      string `json:"host,omitempty"`      // a computer token's computer or session, for the record
	Page      string `json:"page,omitempty"`      // a view address's page
	Version   int    `json:"ver,omitempty"`       // a view address's version of it
	Grant     string `json:"grant,omitempty"`     // a plugin or app token's grant (ADR 0060)
	Iat       int64  `json:"iat"`
	Exp       int64  `json:"exp"`
}

// Sealer seals and opens values under keys derived from AUTH_SECRET.
type Sealer struct {
	secret string
	now    func() time.Time
}

// NewSealer derives from secret; now is the clock, time.Now when nil.
func NewSealer(secret string, now func() time.Time) *Sealer {
	if now == nil {
		now = time.Now
	}
	return &Sealer{secret: secret, now: now}
}

func (s *Sealer) key(p Purpose) []byte {
	k := make([]byte, 32)
	if _, err := io.ReadFull(hkdf.New(sha256.New, []byte(s.secret), []byte(p), []byte("dsh-teamwork sealed value")), k); err != nil {
		panic(err)
	}
	return k
}

// Seal encrypts c for p, expiring after ttl: a compact JWE, dir + A256GCM.
func (s *Sealer) Seal(p Purpose, c Claims, ttl time.Duration) (string, time.Time, error) {
	now := s.now()
	exp := now.Add(ttl)
	c.Iat, c.Exp = now.Unix(), exp.Unix()
	enc, err := jose.NewEncrypter(jose.A256GCM, jose.Recipient{Algorithm: jose.DIRECT, Key: s.key(p)}, nil)
	if err != nil {
		return "", time.Time{}, err
	}
	body, _ := json.Marshal(c)
	obj, err := enc.Encrypt(body)
	if err != nil {
		return "", time.Time{}, err
	}
	out, err := obj.CompactSerialize()
	return out, exp, err
}

var errSealed = errors.New("invalid or expired")

// Open decrypts a value sealed for p, refusing one that has expired.
func (s *Sealer) Open(p Purpose, token string) (Claims, error) {
	var c Claims
	if len(token) > 4096 {
		return c, errSealed
	}
	obj, err := jose.ParseEncrypted(token, []jose.KeyAlgorithm{jose.DIRECT}, []jose.ContentEncryption{jose.A256GCM})
	if err != nil {
		return c, errSealed
	}
	body, err := obj.Decrypt(s.key(p))
	if err != nil || json.Unmarshal(body, &c) != nil || c.Sub == "" || s.now().Unix() >= c.Exp {
		return Claims{}, errSealed
	}
	return c, nil
}
