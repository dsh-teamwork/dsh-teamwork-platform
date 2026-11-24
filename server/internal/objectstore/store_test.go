package objectstore

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalCommitAndReopen(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s := Local{Dir: dir}
	if err := s.Put(ctx, "team", "archive", bytes.NewReader([]byte("original")), 8); err != nil {
		t.Fatal(err)
	}
	if err := s.Put(ctx, "team", "archive", bytes.NewReader([]byte("short")), 8); err == nil {
		t.Fatal("accepted truncated write")
	}
	// A new provider instance must see the committed bytes, not a partial retry.
	r, err := (Local{Dir: dir}).Open(ctx, "team", "archive")
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(r)
	r.Close()
	if err != nil || string(b) != "original" {
		t.Fatalf("read: %q, %v", b, err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "teams", "team", "plugins"))
	if err != nil || len(entries) != 1 {
		t.Fatal("temporary upload leaked", err)
	}
	for _, id := range []string{"", "../outside", "x/y", `x\y`, "x.tgz"} {
		if err := s.Put(ctx, id, "archive", bytes.NewReader(nil), 0); err == nil {
			t.Fatalf("accepted team %q", id)
		}
		if _, err := s.Open(ctx, id, "archive"); err == nil {
			t.Fatalf("opened team %q", id)
		}
		if err := s.Delete(ctx, id, "archive"); err == nil {
			t.Fatalf("deleted team %q", id)
		}
		if err := s.Put(ctx, "team", id, bytes.NewReader(nil), 0); err == nil {
			t.Fatalf("accepted %q", id)
		}
		if _, err := s.Open(ctx, "team", id); err == nil {
			t.Fatalf("opened %q", id)
		}
		if err := s.Delete(ctx, "team", id); err == nil {
			t.Fatalf("deleted %q", id)
		}
	}
	if err := s.Delete(ctx, "team", "archive"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "teams", "team", "plugins", "archive.tgz")); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestScopedKeys(t *testing.T) {
	k, err := key("team_1", "package-1")
	if err != nil || k != "teams/team_1/plugins/package-1.tgz" {
		t.Fatalf("key %q: %v", k, err)
	}
	s := Local{Dir: t.TempDir()}
	for _, team := range []string{"alpha", "beta"} {
		if err := s.Put(t.Context(), team, "same_id", bytes.NewReader([]byte(team)), int64(len(team))); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Delete(t.Context(), "alpha", "same_id"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(s.Dir, "teams", "beta", "plugins", "same_id.tgz"))
	if err != nil || string(b) != "beta" {
		t.Fatal("cross-team deletion", err)
	}
}

func TestProviderConfigurationFailsClosed(t *testing.T) {
	env := map[string]string{}
	get := func(k string) string { return env[k] }
	dir := t.TempDir()
	s, err := FromEnv(dir, get)
	if err != nil || s.(Local).Dir != filepath.Join(dir, "artifacts") {
		t.Fatal(s, err)
	}
	env["ARTIFACT_STORAGE_PROVIDER"] = "s3"
	if _, err := FromEnv(dir, get); err == nil {
		t.Fatal("incomplete S3 fell back to local")
	}
	for _, k := range []string{"BUCKET", "REGION", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"} {
		env["ARTIFACT_S3_"+k] = "test"
	}
	if _, err := FromEnv(dir, get); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"http://example.com", "https://user:secret@example.com", "https://example.com/path", "https://example.com?secret=value"} {
		env["ARTIFACT_S3_ENDPOINT"] = endpoint
		if _, err := FromEnv(dir, get); err == nil {
			t.Fatalf("accepted endpoint %s", endpoint)
		}
	}
	env["ARTIFACT_S3_ENDPOINT"] = "https://storage.example.com"
	env["ARTIFACT_S3_PATH_STYLE"] = "mistake"
	if _, err := FromEnv(dir, get); err == nil {
		t.Fatal("accepted invalid URL style")
	}
	env["ARTIFACT_S3_PATH_STYLE"] = "true"
	if _, err := FromEnv(dir, get); err != nil {
		t.Fatal(err)
	}
	env["ARTIFACT_STORAGE_PROVIDER"] = "s33"
	if _, err := FromEnv(dir, get); err == nil {
		t.Fatal("accepted unknown provider")
	}
}
