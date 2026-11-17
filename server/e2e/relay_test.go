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
	ext := relay.Extension(func(context.Context, []relay.PushMessage) error { return nil }, time.Minute)
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ada := in.Account("ada@example.test")
		in.Team(ada)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(here(), "relay.mjs"))
		cmd.Env = append(os.Environ(), "BASE="+in.URL, "TOKEN="+in.Bearer(ada), "PLUGIN="+plugin)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s", err, out)
		}
	})
}

// A team admin's key signs the plugin's shared mode in for the team alone
// (docs/tech/shared-dsh.md), bound to the first identity that uses it.
func TestPluginSharedMode(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	if _, err := os.Stat(filepath.Join(plugin, "lib", "shared-mode.js")); err != nil {
		t.Fatalf("the DSH plugin at %s has no shared mode (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	ext := relay.Extension(func(context.Context, []relay.PushMessage) error { return nil }, time.Minute)
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ada := in.Account("ada@example.test")
		team := in.Team(ada)
		in.Team(ada) // a second team of the admin's, which the shared DSH must not see
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
		cmd.Env = append(os.Environ(), "BASE="+in.URL, "KEY="+created.Key, "TEAM="+team, "PLUGIN="+plugin)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v\n%s", err, out)
		}
	})
}
