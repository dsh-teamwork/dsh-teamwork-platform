package httpapi_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestHistoryRestorePublishesNewVersionAndRetainsDeletedIdentity(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Restore")
		base := "/api/teams/" + teamID
		config := map[string]any{"kind": "preset", "name": "Original", "data": map[string]any{"inheritModel": true, "systemPrompt": "Original prompt"}}
		c := must(t, admin.post(base+"/configs", config), 201)
		id := c["id"].(string)
		history := jsonArray(t, admin.get(base+"/history?configId="+id))
		old := history[0].(map[string]any)
		config["name"] = "Updated"
		config["version"] = 1
		must(t, admin.send("PATCH", base+"/configs/"+id, config), 200)
		draft := must(t, admin.post(base+"/history/"+old["id"].(string)+"/restore", map[string]any{"baseVersion": 2, "note": "Restore first version"}), 200)
		path := base + "/submissions/" + draft["id"].(string)
		pending := must(t, admin.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		must(t, admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 200)
		history = jsonArray(t, admin.get(base+"/history?configId="+id))
		if len(history) != 3 || history[0].(map[string]any)["version"] != float64(3) || history[2].(map[string]any)["name"] != "Original" {
			t.Fatalf("history: %v", history)
		}
		// A deleted built-in assistant restores its stable identity and increments history.
		rows := jsonArray(t, admin.get(base+"/configs"))
		var builtin string
		for _, v := range rows {
			r := v.(map[string]any)
			if r["builtin"] == "team-assistant" {
				builtin = r["id"].(string)
			}
		}
		old = jsonArray(t, admin.get(base+"/history?configId="+builtin))[0].(map[string]any)
		must(t, admin.send("DELETE", base+"/configs/"+builtin, nil), 204)
		draft = must(t, admin.post(base+"/history/"+old["id"].(string)+"/restore", map[string]any{"baseVersion": 0, "note": "Recover assistant"}), 200)
		path = base + "/submissions/" + draft["id"].(string)
		pending = must(t, admin.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		must(t, admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 200)
		rows = jsonArray(t, admin.get(base+"/configs"))
		found := false
		for _, v := range rows {
			r := v.(map[string]any)
			if r["id"] == builtin {
				found = r["builtin"] == "team-assistant" && r["version"] == float64(2)
			}
		}
		if !found {
			t.Fatal("restore lost builtin identity")
		}
	})
}
func TestBackupContainsExactPrivateArtifact(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Backup")
		base := "/api/teams/" + teamID
		archive := pluginArchive(t, "")
		a := must(t, admin.post(base+"/artifacts", string(archive)), 200)
		c := must(t, admin.post(base+"/configs", map[string]any{"kind": "plugin", "name": "Private", "data": map[string]any{"package": a["package"], "version": a["version"], "artifactId": a["id"], "sha256": a["sha256"]}}), 201)
		history := jsonArray(t, admin.get(base+"/history?configId="+c["id"].(string)))
		r := history[0].(map[string]any)
		download := admin.get(base + "/history/" + r["id"].(string) + "/export")
		if download.status != 200 {
			t.Fatalf("export %d: %s", download.status, download.body)
		}
		gz, err := gzip.NewReader(bytes.NewReader(download.body))
		if err != nil {
			t.Fatal(err)
		}
		defer gz.Close()
		tr := tar.NewReader(gz)
		found := false
		manifest := false
		for {
			h, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			data, _ := io.ReadAll(tr)
			if h.Name == "manifest.json" {
				var m map[string]any
				if json.Unmarshal(data, &m) != nil || m["format"] != float64(1) {
					t.Fatal("invalid backup manifest")
				}
				manifest = true
			} else if bytes.Equal(data, archive) {
				found = true
			}
		}
		if !found || !manifest {
			t.Fatal("backup omitted manifest or exact plugin bytes")
		}
	})
}

func TestApprovedPluginPinSurvivesCatalogUpdate(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Pins")
		base := "/api/teams/" + teamID
		plugin := must(t, admin.post(base+"/configs", map[string]any{"kind": "plugin", "name": "Tool", "data": map[string]any{"package": "test-tool", "version": "1.0.0"}}), 201)
		id := plugin["id"].(string)
		must(t, admin.post(base+"/configs", map[string]any{"kind": "preset", "name": "Pinned", "data": map[string]any{"inheritModel": true, "pluginDependencies": []any{map[string]any{"pluginConfigId": id, "version": "1.0.0"}}}}), 201)
		must(t, admin.send("PATCH", base+"/configs/"+id, map[string]any{"kind": "plugin", "name": "Tool", "version": 1, "data": map[string]any{"package": "test-tool", "version": "2.0.0"}}), 200)
		snap := must(t, e.pluginFor(admin).get("/api/configs"), 200)
		teams := snap["teams"].([]any)
		pins := teams[0].(map[string]any)["pluginVersions"].([]any)
		if len(pins) != 1 || pins[0].(map[string]any)["data"].(map[string]any)["version"] != "1.0.0" {
			t.Fatalf("pins: %v", pins)
		}
	})
}
