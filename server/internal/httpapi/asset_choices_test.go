package httpapi_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetexclusion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetselection"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/plugingrant"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestMemberAssetsAreDiscoverableAndSyncOnlyWhenSelected(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		env := start(t, d, options{})
		admin := env.admin("asset-admin@x.io")
		owner, ownerID := env.person("asset-owner@x.io")
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
		direct := map[string]any{"kind": "preset", "name": "Direct route", "data": map[string]any{"provider": "stub", "model": "member-model"}}
		refused(t, "member preset using a direct provider route", owner.post(base+"/configs", direct), 400, "invalid_request")
		ownerPlugin := env.pluginFor(owner)
		snapshot := must(t, ownerPlugin.get("/api/configs"), 200)["teams"].([]any)[0].(map[string]any)["configs"].([]any)
		if len(snapshot) != 2 {
			t.Fatalf("owner's newly published asset was not selected: %v", snapshot)
		}
		d.Client.ConfigRevision.Create().SetTeamID(teamID).SetConfigID(id).SetVersion(99).SetKind("preset").
			SetName("Historical direct route").SetData(json.RawMessage(`{"provider":"stub","model":"member-model"}`)).SetSource("direct").ExecX(t.Context())
		refused(t, "member selecting a historical direct route", owner.send("PUT", base+"/asset-choices/"+id, map[string]any{"mode": "pinned", "version": 99}), 400, "invalid_request")
		ownerChoice := d.Client.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.ConfigID(id), assetselection.UserID(ownerID)).OnlyX(t.Context())
		if ownerChoice.Mode != assetselection.ModeLatest {
			t.Fatalf("the author does not follow their own asset: %v", ownerChoice)
		}
		d.Client.AssetSelection.UpdateOneID(ownerChoice.ID).SetMode(assetselection.ModePinned).SetVersion(99).ExecX(t.Context())
		refused(t, "gateway rejects an already selected direct route", ownerPlugin.post("/api/llm/chat/completions", map[string]any{"model": id, "messages": []any{map[string]string{"role": "user", "content": "hello"}}}), 403, "model_forbidden")
		must(t, owner.send("PUT", base+"/asset-choices/"+id, map[string]string{"mode": "latest"}), 204)

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
		for _, row := range must(t, ownerPlugin.get("/api/configs"), 200)["teams"].([]any)[0].(map[string]any)["configs"].([]any) {
			if config := row.(map[string]any); config["id"] == id && config["version"] != float64(2) {
				t.Fatalf("the author's own DSH did not follow the new version: %v", config)
			}
		}
		users := must(t, reader.get(base+"/asset-choices"), 200)["users"].(map[string]any)
		if users[id] != float64(4) {
			t.Fatalf("a recommended asset reaches every member: %v", users)
		}
		must(t, reader.send("PUT", personal, map[string]any{"mode": "pinned", "version": 2}), 204)
		assertSnap(2, "Daily notes revised")
		must(t, admin.send("DELETE", base+"/configs/"+id, nil), 204)
		assertSnap(2, "Daily notes revised")
		refused(t, "removed at a version", reader.send("PUT", personal, map[string]any{"mode": "removed", "version": 2}), 400, "invalid_request")
		refused(t, "adding a withdrawn asset", reader.send("PUT", personal, map[string]string{"mode": "latest"}), 409, "config_conflict")
		must(t, reader.send("PUT", personal, map[string]string{"mode": "removed"}), 204)
		assertSnap(0, "")
		if users := must(t, reader.get(base+"/asset-choices"), 200)["users"].(map[string]any); users[id] != float64(3) {
			t.Fatalf("a removal is not counted: %v", users)
		}
		must(t, reader.send("PUT", personal, map[string]string{"mode": "default"}), 204)
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
		delete(preset, "version")
		republished := must(t, owner.post(base+"/configs", preset), 201)
		if republished["id"] != id || republished["version"] != float64(3) {
			t.Fatalf("republishing must restore the original asset identity: %v", republished)
		}
		must(t, admin.send("DELETE", base+"/members/"+ownerID, nil), 204)
		if d.Client.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.UserID(ownerID)).ExistX(t.Context()) {
			t.Fatal("removed member's selections survived")
		}
		for _, row := range jsonArray(t, reader.get(base+"/configs")) {
			if row.(map[string]any)["id"] == id {
				t.Fatal("removed member's asset is still in the catalog")
			}
		}
		assertSnap(1, "Daily notes")

		// A team's own preset is on every member's DSH until they remove it; the assistant stays.
		shared := must(t, admin.post(base+"/configs", map[string]any{"kind": "preset", "name": "Team review", "data": map[string]any{"inheritModel": true}}), 201)["id"].(string)
		has := func(id string) bool {
			for _, row := range must(t, plugin.get("/api/configs"), 200)["teams"].([]any)[0].(map[string]any)["configs"].([]any) {
				if row.(map[string]any)["id"] == id {
					return true
				}
			}
			return false
		}
		refused(t, "pinning a team's own preset", reader.send("PUT", base+"/asset-choices/"+shared, map[string]any{"mode": "pinned", "version": 1}), 400, "invalid_request")
		must(t, reader.send("PUT", base+"/asset-choices/"+shared, map[string]string{"mode": "removed"}), 204)
		if has(shared) {
			t.Fatal("a removed team preset still syncs")
		}
		must(t, reader.send("PUT", base+"/asset-choices/"+shared, map[string]string{"mode": "default"}), 204)
		if !has(shared) {
			t.Fatal("a team preset brought back does not sync")
		}
		for _, row := range jsonArray(t, reader.get(base+"/configs")) {
			if config := row.(map[string]any); config["builtin"] != nil {
				refused(t, "removing the team assistant", reader.send("PUT", base+"/asset-choices/"+config["id"].(string), map[string]string{"mode": "removed"}), 400, "invalid_request")
			}
		}
	})
}

// A member keeps an item off chosen computers; every other computer, a new one included, still syncs it.
func TestAssetsStayOffChosenComputers(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		env := start(t, d, options{})
		admin := env.admin("hosts-admin@x.io")
		member, memberID := env.person("hosts-member@x.io")
		_, strangerID := env.person("hosts-stranger@x.io")
		teamID := newTeam(t, admin, "Team hosts")
		_, token := invite(t, admin, teamID)
		must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		base := "/api/teams/" + teamID
		preset := must(t, admin.post(base+"/configs", map[string]any{"kind": "preset", "name": "Team review", "data": map[string]any{"inheritModel": true}}), 201)["id"].(string)

		laptop, desktop := env.pluginFor(member), env.pluginFor(member)
		grants := d.Client.PluginGrant.Query().Where(plugingrant.UserID(memberID)).Order(ent.Asc(plugingrant.FieldCreatedAt), ent.Asc(plugingrant.FieldID)).AllX(t.Context())
		if len(grants) != 2 {
			t.Fatalf("two sign-ins, got %d", len(grants))
		}
		host := func(user, client, grant string) string {
			return d.Client.RelayHost.Create().SetUserID(user).SetClientID(client).SetName(client).SetDshVersion("1").SetLastSeenAt(time.Now()).SetGrantID(grant).SaveX(t.Context()).ID
		}
		laptopHost := host(memberID, "laptop", grants[0].ID)
		host(memberID, "desktop", grants[1].ID)
		strangerHost := host(strangerID, "theirs", "")
		has := func(p *plugin, id string) bool {
			for _, row := range must(t, p.get("/api/configs"), 200)["teams"].([]any)[0].(map[string]any)["configs"].([]any) {
				if row.(map[string]any)["id"] == id {
					return true
				}
			}
			return false
		}
		hosts := base + "/asset-choices/" + preset + "/hosts"
		refused(t, "another person's computer", member.send("PUT", hosts, map[string]any{"off": []string{strangerHost}}), 404, "host_not_found")
		must(t, member.send("PUT", hosts, map[string]any{"off": []string{laptopHost}}), 204)
		if has(laptop, preset) || !has(desktop, preset) {
			t.Fatal("the preset must stay off the laptop alone")
		}
		// A computer that has not connected yet is not known, so it gets everything.
		if !has(env.pluginFor(member), preset) {
			t.Fatal("a new computer must start with everything")
		}
		off := must(t, member.get(base+"/asset-choices"), 200)["off"].(map[string]any)
		if ids, _ := off[preset].([]any); len(ids) != 1 || ids[0] != laptopHost {
			t.Fatalf("asset choices do not report the computer: %v", off)
		}
		must(t, member.send("PUT", hosts, map[string]any{"off": []string{}}), 204)
		if !has(laptop, preset) {
			t.Fatal("turning the laptop back on must sync the preset again")
		}
		for _, row := range jsonArray(t, member.get(base+"/configs")) {
			if config := row.(map[string]any); config["builtin"] != nil {
				refused(t, "the team assistant off a computer", member.send("PUT", base+"/asset-choices/"+config["id"].(string)+"/hosts", map[string]any{"off": []string{laptopHost}}), 400, "invalid_request")
			}
		}
		// From a DSH panel: an item the member did not have goes on that computer alone.
		author, _ := env.person("hosts-author@x.io")
		_, invited := invite(t, admin, teamID)
		must(t, author.post("/api/invites/redeem", map[string]string{"token": invited}), 200)
		shared := must(t, author.post(base+"/configs", map[string]any{"kind": "preset", "name": "Author notes", "data": map[string]any{"inheritModel": true}}), 201)["id"].(string)
		here := base + "/asset-choices/" + shared + "/here"
		if has(laptop, shared) || has(desktop, shared) {
			t.Fatal("an item nobody added must not sync")
		}
		refused(t, "a computer not connected yet", env.pluginFor(member).send("PUT", here, map[string]bool{"on": true}), 409, "host_unknown")
		must(t, laptop.send("PUT", here, map[string]bool{"on": true}), 204)
		if !has(laptop, shared) || has(desktop, shared) {
			t.Fatal("installing from the laptop must put it on the laptop alone")
		}
		must(t, desktop.send("PUT", here, map[string]bool{"on": true}), 204)
		if !has(laptop, shared) || !has(desktop, shared) {
			t.Fatal("installing from the desktop too must leave it on both")
		}
		must(t, laptop.send("PUT", here, map[string]bool{"on": false}), 204)
		if has(laptop, shared) || !has(desktop, shared) {
			t.Fatal("removing from the laptop must leave the desktop alone")
		}

		must(t, member.send("PUT", hosts, map[string]any{"off": []string{laptopHost}}), 204)
		must(t, admin.send("DELETE", base+"/members/"+memberID, nil), 204)
		if d.Client.AssetExclusion.Query().Where(assetexclusion.UserID(memberID)).ExistX(t.Context()) {
			t.Fatal("a removed member's computer choices survived")
		}
	})
}
