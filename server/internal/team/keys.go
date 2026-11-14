package team

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Keys seals provider keys at rest (ADR 0006): AES-256-GCM under
// PROVIDER_KEYS_SECRET, each bound to its team and provider name, so a row
// copied to another team or renamed no longer opens. Losing the secret loses
// every stored provider key and nothing else.
type Keys struct{ aead cipher.AEAD }

// NewKeys takes the 32-byte secret.
func NewKeys(secret []byte) (*Keys, error) {
	block, err := aes.NewCipher(secret)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Keys{aead: aead}, nil
}

var b64 = base64.RawURLEncoding

func bound(teamID, name string) []byte { return []byte(teamID + "\n" + name) }

// Seal is `v1.iv.tag.ciphertext`, each base64url: the format the Node server
// wrote.
func (k *Keys) Seal(teamID, name, key string) string {
	iv := make([]byte, k.aead.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		panic(err)
	}
	out := k.aead.Seal(nil, iv, []byte(key), bound(teamID, name))
	ct, tag := out[:len(out)-k.aead.Overhead()], out[len(out)-k.aead.Overhead():]
	return strings.Join([]string{"v1", b64.EncodeToString(iv), b64.EncodeToString(tag), b64.EncodeToString(ct)}, ".")
}

// Open is the key, or provider_keys_unavailable when the secret is not the
// one it was sealed with.
func (k *Keys) Open(teamID, name, sealed string) (string, error) {
	unavailable := wire.E(http.StatusServiceUnavailable, wire.ProviderKeysUnavailable)
	parts := strings.Split(sealed, ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return "", unavailable
	}
	iv, err1 := b64.DecodeString(parts[1])
	tag, err2 := b64.DecodeString(parts[2])
	ct, err3 := b64.DecodeString(parts[3])
	if err1 != nil || err2 != nil || err3 != nil || len(iv) != k.aead.NonceSize() {
		return "", unavailable
	}
	plain, err := k.aead.Open(nil, iv, append(ct, tag...), bound(teamID, name))
	if err != nil {
		return "", unavailable
	}
	return string(plain), nil
}
