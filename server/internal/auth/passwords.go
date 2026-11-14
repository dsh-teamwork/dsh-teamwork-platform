package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
)

// scrypt at 2^15 × 8: 32 MiB per hash, a fraction of a second on a server.
// The parameters are stored beside each hash, so raising them needs no
// migration: an old hash verifies under the parameters it was made with.
const (
	costN, costR, costP = 1 << 15, 8, 1
	keyBytes            = 32
)

var b64 = base64.RawURLEncoding

// HashPassword is `scrypt$N$r$p$salt$key`, salt and key base64url: the format
// the Node server wrote.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := scrypt.Key([]byte(norm.NFKC.String(password)), salt, costN, costR, costP, keyBytes)
	if err != nil {
		return "", err
	}
	return strings.Join([]string{"scrypt", strconv.Itoa(costN), strconv.Itoa(costR), strconv.Itoa(costP), b64.EncodeToString(salt), b64.EncodeToString(key)}, "$"), nil
}

// VerifyPassword compares in constant time; a malformed hash never matches.
func VerifyPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 6 || parts[0] != "scrypt" {
		return false
	}
	n, err1 := strconv.Atoi(parts[1])
	r, err2 := strconv.Atoi(parts[2])
	p, err3 := strconv.Atoi(parts[3])
	salt, err4 := b64.DecodeString(parts[4])
	want, err5 := b64.DecodeString(parts[5])
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil || err5 != nil || n > 1<<20 || r > 32 || p > 16 {
		return false
	}
	got, err := scrypt.Key([]byte(norm.NFKC.String(password)), salt, n, r, p, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// GeneratePassword is a first password an admin hands over: 120 random bits,
// typeable.
func GeneratePassword() string {
	b := make([]byte, 15)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b64.EncodeToString(b)
}

// SetupToken is the first account's token: derived from AUTH_SECRET, so it
// survives a restart and needs no table. The Node server derived it the same
// way.
func SetupToken(secret string) string {
	m := hmac.New(sha256.New, []byte(secret))
	fmt.Fprint(m, "dsh-teamwork:first-account")
	return b64.EncodeToString(m.Sum(nil))
}
