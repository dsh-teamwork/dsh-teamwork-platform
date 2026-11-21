//go:build e2e

package e2e

// The relay (docs/tech/relay.md) driven by the DSH plugin's own relay client
// and shared mode, unchanged, on each database the suites reach.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
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
	ext := relay.Extension(time.Minute, false)
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

// A team admin's key signs the plugin's shared mode in for the team alone
// (docs/tech/shared-dsh.md), bound to the first identity that uses it; a
// member's handset then joins it by invite through the relay, and a member
// without one is refused.
func TestPluginSharedMode(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	if _, err := os.Stat(filepath.Join(plugin, "lib", "shared-mode.js")); err != nil {
		t.Fatalf("the DSH plugin at %s has no shared mode (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	ext := relay.Extension(time.Minute, true)
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ada := in.Account("ada@example.test")
		team := in.Team(ada)
		in.Team(ada) // a second team of the admin's, which the shared DSH must not see
		bob, eve := in.Account("bob@example.test"), in.Account("eve@example.test")
		in.Member(team, bob)
		in.Member(team, eve)
		req, _ := http.NewRequest("POST", in.URL+"/api/teams/"+team+"/shared-hosts", bytes.NewReader([]byte(`{"name":"Build box"}`)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", in.URL)
		req.AddCookie(in.Session(ada, "password"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var created struct{ Key string }
		json.NewDecoder(res.Body).Decode(&created)
		res.Body.Close()
		if res.StatusCode != 201 || created.Key == "" {
			t.Fatalf("create: %d", res.StatusCode)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(here(), "shared.mjs"))
		cmd.Env = append(os.Environ(), "BASE="+in.URL, "KEY="+created.Key, "TEAM="+team, "PLUGIN="+plugin,
			"BOB="+bob, "BOB_TOKEN="+in.Bearer(bob), "EVE_TOKEN="+in.Bearer(eve), "ADMIN_COOKIE="+in.Session(ada, "password").String())
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s", err, out)
		}
	})
}
