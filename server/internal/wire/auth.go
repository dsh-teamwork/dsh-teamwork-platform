package wire

import (
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The codes a sign-in answers with when it did not work (AUTH_ERRORS).
const (
	InvalidEmail           = "invalid_email"
	InvalidCode            = "invalid_code"
	CodeExpired            = "code_expired"
	TooManyAttempts        = "too_many_attempts"
	NotAllowed             = "not_allowed"
	Unavailable            = "unavailable"
	InvalidCredentials     = "invalid_credentials"
	WeakPassword           = "weak_password"
	SetupClosed            = "setup_closed"
	PasswordChangeRequired = "password_change_required"
)

// PasswordMin is the shortest password a person may choose: long rather than
// complicated (NIST SP 800-63B).
const PasswordMin = 10

// emailPattern is the one Zod's z.email() uses, so both servers accept the
// same addresses.
var emailPattern = regexp.MustCompile(`^(?:[A-Za-z0-9_'+\-]+(?:\.[A-Za-z0-9_'+\-]+)*)@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$`)

// NormalizeEmail is the form an address is stored and compared in.
func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// Email is a normalized address, or ok false.
func Email(s string) (string, bool) {
	e := NormalizeEmail(s)
	return e, len(e) <= 254 && emailPattern.MatchString(e)
}

// ValidPassword is a password a person may choose. Never trimmed: a space is
// part of it.
func ValidPassword(p string) bool {
	n := utf8.RuneCountInString(p)
	return n >= PasswordMin && n <= 256
}

// PluginChallenge is an RFC 7636 S256 challenge: base64url of a SHA-256.
var PluginChallenge = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// PasswordSignIn is POST /api/auth/password/sign-in.
type PasswordSignIn struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Setup is POST /api/auth/setup: the first account, with the printed token.
type Setup struct {
	Token    string `json:"token"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// ChangePassword is POST /api/auth/password/change.
type ChangePassword struct {
	Current string `json:"current"`
	Next    string `json:"next"`
}

// PluginCode is POST /api/auth/plugin/code: confirm, and get a code bound to
// the challenge; with redirectUri, where the code may be sent.
type PluginCode struct {
	Challenge   string `json:"challenge"`
	RedirectURI string `json:"redirectUri,omitempty"`
}

// PluginToken is POST /api/auth/plugin/token, the plugin's exchange.
type PluginToken struct {
	Code     string `json:"code"`
	Verifier string `json:"verifier"`
}

// ReturnTo is where a plugin code may be sent instead of shown: the DSH
// plugin's loopback listener (ADR 0012), or a phone app's address under
// MOBILE_REDIRECT_URI (ADR 0010). Empty To means nowhere.
type ReturnTo struct {
	URL string `json:"url"`
	To  string `json:"to"` // "dsh" or "app"
}

// ReturnAddress decides a redirect_uri: RFC 8252 §7.3 plain http to the IPv4
// loopback literal on an explicit port, or an address under mobilePrefix.
func ReturnAddress(uri, mobilePrefix string) (ReturnTo, bool) {
	if u, err := url.Parse(uri); err == nil && u.Scheme == "http" && u.Hostname() == "127.0.0.1" && u.Port() != "" && u.User == nil {
		return ReturnTo{URL: uri, To: "dsh"}, true
	}
	if mobilePrefix != "" && strings.HasPrefix(uri, mobilePrefix) {
		return ReturnTo{URL: uri, To: "app"}, true
	}
	return ReturnTo{}, false
}

// ReturnPath is where to go after signing in: a path on this site, or
// fallback. Anything that could leave the origin is the fallback.
func ReturnPath(asked, fallback string) string {
	if asked == "" || len(asked) > 512 || !strings.HasPrefix(asked, "/") || strings.HasPrefix(asked, "//") {
		return fallback
	}
	for _, r := range asked {
		if r == '\\' || r < 0x20 {
			return fallback
		}
	}
	u, err := url.Parse("https://return.invalid" + asked)
	if err != nil || u.Host != "return.invalid" {
		return fallback
	}
	return asked
}
