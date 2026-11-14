package config

import (
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
