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
	Session       Purpose = "dsh-teamwork.session"
	PluginHandoff Purpose = "dsh-teamwork.plugin-handoff"
	PluginBearer  Purpose = "dsh-teamwork.plugin-session"
)

// SessionTTL is how long a browser session and a plugin token last. Neither
// can be revoked before it expires — the price of having no session table;
// team access is still re-checked on every request.
const SessionTTL = 30 * 24 * time.Hour

// HandoffTTL is how long a plugin's sign-in code lives.
const HandoffTTL = 2 * time.Minute

// Claims is what a sealed value carries.
type Claims struct {
	Sub       string `json:"sub"`                 // the user id
	Via       string `json:"via,omitempty"`       // the door: password, email, google, feishu
	Challenge string `json:"challenge,omitempty"` // a hand-off code's PKCE challenge
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
