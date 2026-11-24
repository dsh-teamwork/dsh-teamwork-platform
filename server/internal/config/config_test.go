package config

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestSecretsAreWrittenOnFirstStart(t *testing.T) {
	dir := t.TempDir()
	c, err := Load([]string{"--data", dir}, env(nil))
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "secrets.json"))
	if err != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("secrets.json: %v %v", info, err)
	}
	again, err := Load([]string{"--data", dir}, env(nil))
	if err != nil || again.AuthSecret != c.AuthSecret || string(again.ProviderKeysSecret) != string(c.ProviderKeysSecret) {
		t.Fatal("a second start did not read the same secrets")
	}
	if c.AppURL != "http://localhost:3800" {
		t.Fatalf("default APP_URL %q", c.AppURL)
	}
}

// A secret a stranger could guess would let them claim the first account and
// forge sessions, so the server will not start on one.
func TestWeakAuthSecretIsRefused(t *testing.T) {
	if _, err := Load([]string{"--data", t.TempDir()}, env(map[string]string{"AUTH_SECRET": "short"})); err == nil {
		t.Error("a short AUTH_SECRET was accepted")
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "secrets.json"), []byte(`{"AUTH_SECRET":"","PROVIDER_KEYS_SECRET":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}`), 0o600)
	if _, err := Load([]string{"--data", dir}, env(nil)); err == nil {
		t.Error("an empty stored AUTH_SECRET was accepted")
	}
	if _, err := Load([]string{"--data", dir}, env(map[string]string{"AUTH_SECRET": " "})); err == nil {
		t.Error("a blank AUTH_SECRET fell back to an empty stored one")
	}
}

// PROVIDER_KEYS_SECRET is read as the Node server read it (Buffer.from(…,
// 'base64')): standard or URL-safe, padded or not, line breaks ignored. A key
// a deployment already holds starts the Go server too; one that is not 32
// bytes still does not.
func TestProviderKeysSecretEncodings(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(250 - i) // high bytes, so the URL-safe alphabet differs
	}
	std := base64.StdEncoding.EncodeToString(key)
	for name, value := range map[string]string{
		"standard":          std,
		"unpadded":          base64.RawStdEncoding.EncodeToString(key),
		"url-safe":          base64.URLEncoding.EncodeToString(key),
		"url-safe raw":      base64.RawURLEncoding.EncodeToString(key),
		"wrapped":           std[:20] + "\n" + std[20:],
		"surrounding space": "  " + std + "\n",
	} {
		c, err := Load([]string{"--data", t.TempDir()}, env(map[string]string{"PROVIDER_KEYS_SECRET": value}))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if string(c.ProviderKeysSecret) != string(key) {
			t.Errorf("%s: decoded to another key", name)
		}
	}
	for name, value := range map[string]string{
		"16 bytes":   base64.StdEncoding.EncodeToString(key[:16]),
		"not base64": "not a key at all, not even close!!!!!!!!!!",
	} {
		if _, err := Load([]string{"--data", t.TempDir()}, env(map[string]string{"PROVIDER_KEYS_SECRET": value})); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// REVIEW_SIGN_IN is an address and six digits, and only where codes are
// emailed: without SMTP_URL there is no code for it to replace.
func TestReviewSignIn(t *testing.T) {
	c, err := Load([]string{"--data", t.TempDir()}, env(map[string]string{"SMTP_URL": "smtp://mail.example", "REVIEW_SIGN_IN": " Review@Example.com:246810 "}))
	if err != nil {
		t.Fatal(err)
	}
	if c.ReviewEmail != "review@example.com" || c.ReviewCode != "246810" {
		t.Fatalf("review %q %q", c.ReviewEmail, c.ReviewCode)
	}
	for _, bad := range []map[string]string{
		{"SMTP_URL": "smtp://mail.example", "REVIEW_SIGN_IN": "review@example.com"},
		{"SMTP_URL": "smtp://mail.example", "REVIEW_SIGN_IN": "review@example.com:12345"},
		{"SMTP_URL": "smtp://mail.example", "REVIEW_SIGN_IN": "not an address:246810"},
		{"REVIEW_SIGN_IN": "review@example.com:246810"},
	} {
		if _, err := Load([]string{"--data", t.TempDir()}, env(bad)); err == nil {
			t.Fatalf("accepted %v", bad)
		}
	}
}

func TestServiceRoleValidation(t *testing.T) {
	for _, role := range []string{"", "combined", "user", "manage", "manager"} {
		c, err := Load([]string{"--data", t.TempDir()}, env(map[string]string{"SERVICE_ROLE": role}))
		if role == "manager" {
			if err == nil {
				t.Fatal("invalid role accepted")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if role == "" {
			role = "combined"
		}
		if c.ServiceRole != role {
			t.Fatalf("role %q", c.ServiceRole)
		}
	}
}

// Artifacts are served from CONTENT_URL only where it is another site than
// APP_URL's: a subdomain would share the site the console's cookies go to.
func TestContentURLIsASiteOfItsOwn(t *testing.T) {
	load := func(content string) (Config, error) {
		return Load([]string{"--data", t.TempDir()}, env(map[string]string{"APP_URL": "https://www.dshteamwork.com", "CONTENT_URL": content}))
	}
	if c, err := load(""); err != nil || c.ContentURL != "https://www.dshteamwork.com" {
		t.Fatalf("unset: %q %v", c.ContentURL, err)
	}
	if c, err := load("https://dshteam.work/"); err != nil || c.ContentURL != "https://dshteam.work" {
		t.Fatalf("another site: %q %v", c.ContentURL, err)
	}
	// A subdomain of another site is that other site, as the hosted service's is.
	if c, err := load("https://artifacts.dshteam.work"); err != nil || c.ContentURL != "https://artifacts.dshteam.work" {
		t.Fatalf("a subdomain of another site: %q %v", c.ContentURL, err)
	}
	for _, bad := range []string{"https://pages.dshteamwork.com", "https://dshteamwork.com", "http://dshteam.work", "https://dshteam.work/a", "dshteam.work"} {
		if _, err := load(bad); err == nil {
			t.Errorf("CONTENT_URL %q was accepted", bad)
		}
	}
}
