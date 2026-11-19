//go:build e2e

package e2e

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// The plugin's panel draws preset avatars from its own copy of the shared
// library, since it cannot import the package; the copy must stay exact.
func TestPluginKeepsTheAvatarLibrary(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	source, err := os.ReadFile(filepath.Join(here(), "..", "..", "packages", "shared", "src", "avatars.ts"))
	if err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(filepath.Join(plugin, "src", "web", "avatars.ts"))
	if err != nil {
		t.Fatalf("the DSH plugin at %s has no avatar library (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	if !bytes.Equal(source, copied) {
		t.Fatalf("%s differs from packages/shared/src/avatars.ts: copy it over", filepath.Join(plugin, "src", "web", "avatars.ts"))
	}
}
