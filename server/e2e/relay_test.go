//go:build e2e

package e2e

// The relay (docs/tech/relay.md) driven by the DSH plugin's own relay client,
// unchanged, on each database the suites reach.

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/relay"
)

func TestPluginRelay(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	if _, err := os.Stat(filepath.Join(plugin, "lib", "relay.js")); err != nil {
		t.Fatalf("the DSH plugin is not at %s (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	ext := relay.Extension(time.Minute)
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ada := in.Account("ada@example.test")
		in.Team(ada)
		// The phone app's handset, then the web console's: the same pairing, admitted by a cookie from this site.
		for _, browser := range []string{"", in.Session(ada, "password").String()} {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			cmd := exec.CommandContext(ctx, "node", filepath.Join(here(), "relay.mjs"))
			cmd.Env = append(os.Environ(), "BASE="+in.URL, "TOKEN="+in.Bearer(ada), "PLUGIN="+plugin, "COOKIE="+browser)
			out, err := cmd.CombinedOutput()
			cancel()
			if err != nil {
				t.Fatalf("browser %t: %v\n%s", browser != "", err, out)
			}
		}
		// The built plugin reports its own version, read from its package, and the relay records it (ADR 0061).
		var pkg struct{ Version string }
		if b, err := os.ReadFile(filepath.Join(plugin, "package.json")); err != nil || json.Unmarshal(b, &pkg) != nil || pkg.Version == "" {
			t.Fatalf("the plugin's package version: %v", err)
		}
		var recorded string
		if err := in.SQL.QueryRowContext(context.Background(), "SELECT plugin_version FROM relay_hosts WHERE user_id = '"+ada+"'").Scan(&recorded); err != nil || recorded != pkg.Version {
			t.Fatalf("recorded plugin version %q (%v), want %q", recorded, err, pkg.Version)
		}
	})
}
