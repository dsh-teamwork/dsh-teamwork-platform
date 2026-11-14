package config

import (
	"encoding/base64"
	"os"
	"path/filepath"
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
	if err != nil || info.Mode().Perm() != 0o600 {
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
