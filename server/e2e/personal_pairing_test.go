//go:build e2e

package e2e

// A browser-shaped client (packages/relay-client) pairs with the plugin's own
// pairing code through the relay, on each database the suites reach.

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/relay"
)

func TestPersonalPairing(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	if _, err := os.Stat(filepath.Join(plugin, "lib", "phone-security.js")); err != nil {
		t.Fatalf("the DSH plugin is not at %s (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	ext := relay.Extension(func(context.Context, []relay.PushMessage) error { return nil }, time.Minute, false)
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ada := in.Account("ada@example.test")
		in.Team(ada)
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "npx", "vitest", "run", "src/__tests__/personal-pairing.live.test.ts")
		cmd.Dir = filepath.Join(here(), "..", "..", "packages", "relay-client")
		cmd.Env = append(os.Environ(), "BASE="+in.URL, "TOKEN="+in.Bearer(ada), "PLUGIN="+plugin, "DIR="+t.TempDir())
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s", err, out)
		}
	})
}
