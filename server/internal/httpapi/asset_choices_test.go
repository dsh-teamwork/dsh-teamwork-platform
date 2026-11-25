package httpapi_test

import (
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestMemberAssetsAreDiscoverableAndSyncOnlyWhenSelected(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		env := start(t, d, options{})
		admin := env.admin("asset-admin@x.io")
		owner, _ := env.person("asset-owner@x.io")
		newcomer, _ := env.person("asset-newcomer@x.io")
		reader, _ := env.person("asset-reader@x.io")
		outsider, _ := env.person("asset-outsider@x.io")
		teamID := newTeam(t, admin, "Team assets")
		for _, member := range []*browser{owner, reader} {
			_, token := invite(t, admin, teamID)
			must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		}
		base := "/api/teams/" + teamID
		preset := map[string]any{"kind": "preset", "name": "Daily notes", "data": map[string]any{"inheritModel": true}}
		id := must(t, owner.post(base+"/configs", preset), 201)["id"].(string)
		if configs := jsonArray(t, reader.get(base+"/configs")); len(configs) != 2 {
			t.Fatalf("member upload is missing from catalog: %v", configs)
		}
		refused(t, "outsider reading", outsider.get(base+"/configs"), 404, "team_not_found")
		personal, teamDefault := base+"/asset-choices/"+id, base+"/asset-defaults/"+id
		refused(t, "member changing team default", reader.send("PUT", teamDefault, map[string]int{"version": 1}), 403, "admin_required")
		plugin := env.pluginFor(reader)
		assertSnap := func(version int, name string) {
			t.Helper()
			teams := must(t, plugin.get("/api/configs"), 200)["teams"].([]any)
			for _, row := range teams[0].(map[string]any)["configs"].([]any) {
				config := row.(map[string]any)
				if config["id"] != id {
					continue
				}
				if config["version"] != float64(version) || config["name"] != name {
					t.Fatalf("unexpected asset in snapshot: %v", config)
				}
				return
			}
			if version != 0 {
				t.Fatalf("missing version %d in snapshot: %v", version, teams)
			}
		}
		assertSnap(0, "")
		must(t, admin.send("PUT", teamDefault, map[string]any{"version": 1, "name": "Team notes"}), 204)
		assertSnap(1, "Team notes")
		_, token := invite(t, admin, teamID)
		must(t, newcomer.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		newTeams := must(t, env.pluginFor(newcomer).get("/api/configs"), 200)["teams"].([]any)
		newConfigs := newTeams[0].(map[string]any)["configs"].([]any)
		if len(newConfigs) != 2 {
			t.Fatalf("new member did not inherit the default: %v", newConfigs)
		}
		preset["version"] = 1
		preset["name"] = "Daily notes revised"
		refused(t, "member editing another member's asset", reader.send("PATCH", base+"/configs/"+id, preset), 403, "config_owned")
		must(t, owner.send("PATCH", base+"/configs/"+id, preset), 200)
		assertSnap(1, "Team notes")
		must(t, reader.send("PUT", personal, map[string]int{"version": 2}), 204)
		assertSnap(2, "Daily notes revised")
		must(t, owner.send("DELETE", base+"/configs/"+id, nil), 204)
		assertSnap(2, "Daily notes revised")
		must(t, reader.send("PUT", personal, map[string]bool{"disabled": true}), 204)
		assertSnap(0, "")
		must(t, reader.send("PUT", personal, map[string]any{}), 204)
		assertSnap(1, "Team notes")
		archived := must(t, reader.get(base+"/asset-choices"), 200)["archived"].([]any)
		if len(archived) != 1 || archived[0].(map[string]any)["id"] != id {
			t.Fatalf("archive unavailable to members with defaults: %v", archived)
		}
		refused(t, "stale team default", admin.send("PUT", teamDefault, map[string]int{"revision": 0}), 409, "config_conflict")
		must(t, admin.send("PUT", teamDefault, map[string]int{"revision": 1}), 204)
		assertSnap(0, "")
		refused(t, "team default changed to an unadopted archived version", admin.send("PUT", teamDefault, map[string]int{"version": 2, "revision": 2}), 409, "config_conflict")
		must(t, admin.send("PUT", teamDefault, map[string]int{"version": 1, "revision": 2}), 204)
		assertSnap(1, "Daily notes")
	})
}
