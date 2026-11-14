// Package config reads what an instance is told at start: flags, then the
// environment variables the Node server read, then what the data directory
// holds. With nothing set the binary still starts (ADR 0006): SQLite and the
// secrets live in the data directory, written on first start.
package config

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// MinAuthSecret is the shortest AUTH_SECRET accepted.
const MinAuthSecret = 32

// Config is everything the server reads at start.
type Config struct {
	DataDir     string
	Host        string
	Port        int
	AppURL      string // the public origin, without a trailing slash
	DatabaseURL string

	AuthSecret         string // signs sessions, tokens and the setup link
	ProviderKeysSecret []byte // 32 bytes; seals provider keys

	AllowPrivateProviders bool
	SMTPURL               string // set: emailed codes; unset: passwords
	EmailFrom             string // AUTH_EMAIL_FROM
	MobileRedirectURI     string

	GoogleID, GoogleSecret string // both set: the Google door

	PostHogKey, PostHogHost string // POSTHOG_KEY set: server analytics
}

// Google is whether the Google door is configured.
func (c Config) Google() bool { return c.GoogleID != "" && c.GoogleSecret != "" }

// Passwords is whether the email door is a password: no SMTP to send codes.
func (c Config) Passwords() bool { return c.SMTPURL == "" }

// Load reads flags from args and the environment from env.
func Load(args []string, env func(string) string) (Config, error) {
	home, _ := os.UserHomeDir()
	fl := flag.NewFlagSet("dsh-teamwork", flag.ContinueOnError)
	data := fl.String("data", filepath.Join(home, ".dsh-teamwork"), "data directory: the SQLite database and generated secrets")
	host := fl.String("host", "", "address to listen on (default 127.0.0.1; HOST)")
	port := fl.Int("port", 0, "port to listen on (default 3800; PORT)")
	if err := fl.Parse(args); err != nil {
		return Config{}, err
	}
	c := Config{
		DataDir:               *data,
		Host:                  first(*host, env("HOST"), "127.0.0.1"),
		DatabaseURL:           strings.TrimSpace(env("DATABASE_URL")),
		AllowPrivateProviders: strings.TrimSpace(env("ALLOW_PRIVATE_PROVIDERS")) == "true",
		SMTPURL:               strings.TrimSpace(env("SMTP_URL")),
		MobileRedirectURI:     strings.TrimSpace(env("MOBILE_REDIRECT_URI")),
		EmailFrom:             strings.TrimSpace(env("AUTH_EMAIL_FROM")),
		GoogleID:              strings.TrimSpace(env("AUTH_GOOGLE_ID")),
		GoogleSecret:          strings.TrimSpace(env("AUTH_GOOGLE_SECRET")),
		PostHogKey:            strings.TrimSpace(env("POSTHOG_KEY")),
		PostHogHost:           strings.TrimRight(strings.TrimSpace(env("POSTHOG_HOST")), "/"),
	}
	c.Port = *port
	if c.Port == 0 {
		c.Port = 3800
		if p := strings.TrimSpace(env("PORT")); p != "" {
			n, err := strconv.Atoi(p)
			if err != nil || n <= 0 || n > 65535 {
				return Config{}, fmt.Errorf("PORT: %q is not a port", p)
			}
			c.Port = n
		}
	}
	c.AppURL = strings.TrimRight(strings.TrimSpace(env("APP_URL")), "/")
	if c.AppURL == "" {
		c.AppURL = "http://" + net.JoinHostPort(displayHost(c.Host), strconv.Itoa(c.Port))
	}
	if err := os.MkdirAll(c.DataDir, 0o700); err != nil {
		return Config{}, fmt.Errorf("data directory: %w", err)
	}
	authEnv, keysEnv := strings.TrimSpace(env("AUTH_SECRET")), strings.TrimSpace(env("PROVIDER_KEYS_SECRET"))
	stored, err := secrets(c.DataDir, authEnv == "" || keysEnv == "")
	if err != nil {
		return Config{}, err
	}
	// The secret every session, token and the setup link derive from: one a
	// stranger could guess would let them claim the first account.
	if c.AuthSecret = first(authEnv, stored.AuthSecret); len(c.AuthSecret) < MinAuthSecret {
		return Config{}, fmt.Errorf("AUTH_SECRET: at least %d characters of random (openssl rand -base64 32)", MinAuthSecret)
	}
	keys := first(keysEnv, stored.ProviderKeysSecret)
	if c.ProviderKeysSecret, err = decodeKey(keys); err != nil || len(c.ProviderKeysSecret) != 32 {
		return Config{}, errors.New("PROVIDER_KEYS_SECRET: 32 random bytes in base64 (openssl rand -base64 32)")
	}
	return c, nil
}

// decodeKey reads base64 as the Node server's Buffer.from(s, 'base64') did,
// so a key a deployment already holds keeps working: the standard and the
// URL-safe alphabets alike, padding optional, whitespace ignored.
func decodeKey(s string) ([]byte, error) {
	s = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\r', '\n', '=':
			return -1
		case '-':
			return '+'
		case '_':
			return '/'
		}
		return r
	}, s)
	return base64.RawStdEncoding.DecodeString(s)
}

type storedSecrets struct {
	AuthSecret         string `json:"AUTH_SECRET"`
	ProviderKeysSecret string `json:"PROVIDER_KEYS_SECRET"`
}

// secrets reads the data directory's secrets.json, writing it first when it
// is missing and some secret is not in the environment. Readable only by the
// user who runs the server.
func secrets(dir string, needed bool) (storedSecrets, error) {
	path := filepath.Join(dir, "secrets.json")
	var s storedSecrets
	b, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(b, &s); err != nil {
			return s, fmt.Errorf("%s: %w", path, err)
		}
		return s, nil
	}
	if !errors.Is(err, fs.ErrNotExist) || !needed {
		if needed {
			return s, err
		}
		return s, nil
	}
	s = storedSecrets{AuthSecret: random(32), ProviderKeysSecret: random(32)}
	b, _ = json.MarshalIndent(s, "", "  ")
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return s, err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return s, err
}

func random(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func first(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// displayHost is the host the default APP_URL names. Loopback and the
// unspecified address are localhost, the name a person types; any other
// address a browser reaches the server by needs APP_URL set to it, since a
// write must come from APP_URL's origin.
func displayHost(h string) string {
	if h == "" || h == "0.0.0.0" || h == "::" || h == "127.0.0.1" || h == "::1" {
		return "localhost"
	}
	return h
}
