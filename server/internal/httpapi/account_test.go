package httpapi_test

import (
	"context"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourcesubmission"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestHandingOverAdmin(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin, adminID := e.person("admin@x.io")
		member, memberID := e.person("member@x.io")
		outsider, outsiderID := e.person("outsider@x.io")
		teamID := newTeam(t, admin, "Shared")
		_, token := invite(t, admin, teamID)
		must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)

		path := "/api/teams/" + teamID + "/members/"
		refused(t, "a member handing over", member.post(path+adminID+"/admin", nil), 403, "admin_required")
		refused(t, "handing over to oneself", admin.post(path+adminID+"/admin", nil), 400, "already_admin")
		refused(t, "handing over to an outsider", admin.post(path+outsiderID+"/admin", nil), 404, "member_not_found")
		_ = outsider

		must(t, admin.post(path+memberID+"/admin", nil), 204)
		if role := must(t, member.get("/api/teams/"+teamID), 200)["role"]; role != "admin" {
			t.Fatalf("new admin's role: %v", role)
		}
		if role := must(t, admin.get("/api/teams/"+teamID), 200)["role"]; role != "member" {
			t.Fatalf("former admin's role: %v", role)
		}
		refused(t, "the former admin acting as one", admin.post(path+memberID+"/admin", nil), 403, "admin_required")
		// The former admin can now leave; the team keeps its one admin.
		must(t, admin.send("DELETE", "/api/teams/"+teamID+"/membership", nil), 204)
	})
}

func TestDeletingAnAccount(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{})
		owner, ownerID := e.person("owner@x.io")
		other, otherID := e.person("other@x.io")
		solo := newTeam(t, owner, "Alone")
		must(t, owner.post("/api/teams/"+solo+"/configs", map[string]any{"kind": "preset", "name": "Mine", "data": map[string]any{"inheritModel": true, "description": "Mine", "requiredTools": []string{}, "optionalTools": []string{}, "systemPrompt": "Be brief."}}), 201)
		// What the lone team holds beyond its configs: a draft and a budget.
		must(t, owner.post("/api/teams/"+solo+"/submissions", map[string]any{"config": map[string]any{"kind": "preset", "name": "Draft", "data": map[string]any{"inheritModel": true}}, "baseVersion": 0, "note": ""}), 200)
		must(t, owner.send("PUT", "/api/teams/"+solo+"/budgets", budgetBody("team", "", "10", 0)), 200)
		shared := newTeam(t, owner, "Shared")
		_, token := invite(t, owner, shared)
		must(t, other.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		theirs := newTeam(t, other, "Theirs")
		_, token = invite(t, other, theirs)
		must(t, owner.post("/api/invites/redeem", map[string]string{"token": token}), 200)

		refused(t, "a confirmation that is not the email", owner.send("DELETE", "/api/profile", map[string]string{"confirm": "someone@x.io"}), 400, "confirmation_mismatch")
		refused(t, "admin of a team with others in it", owner.send("DELETE", "/api/profile", map[string]string{"confirm": "owner@x.io"}), 409, "admin_of_shared_team")
		if !d.Client.User.Query().Where(user.ID(ownerID)).ExistX(ctx) || !d.Client.Team.Query().Where(team.ID(solo)).ExistX(ctx) {
			t.Fatal("a refused deletion changed something")
		}

		must(t, owner.post("/api/teams/"+shared+"/members/"+otherID+"/admin", nil), 204)
		must(t, owner.send("DELETE", "/api/profile", map[string]string{"confirm": " Owner@X.io "}), 204)

		if d.Client.User.Query().Where(user.ID(ownerID)).ExistX(ctx) {
			t.Fatal("the account is still there")
		}
		if d.Client.Team.Query().Where(team.ID(solo)).ExistX(ctx) || d.Client.TeamConfig.Query().Where(teamconfig.TeamID(solo)).ExistX(ctx) {
			t.Fatal("the team the account was alone in is still there")
		}
		if d.Client.ResourceSubmission.Query().Where(resourcesubmission.TeamID(solo)).ExistX(ctx) || d.Client.BudgetPolicy.Query().Where(budgetpolicy.TeamID(solo)).ExistX(ctx) {
			t.Fatal("rows of the deleted team are left behind")
		}
		for _, id := range []string{shared, theirs} {
			v := must(t, other.get("/api/teams/"+id), 200)
			if n := len(v["members"].([]any)); n != 1 {
				t.Fatalf("team %s still lists %d members", id, n)
			}
		}
		refused(t, "the deleted account's session", owner.get("/api/profile"), 401, "unauthorized")
		// The address can sign up again as a new account; nothing of the old one returns.
		again, againID := e.person("owner@x.io")
		if againID == ownerID {
			t.Fatal("the new account reuses the old id")
		}
		if teams := jsonArray(t, again.get("/api/teams")); len(teams) != 0 {
			t.Fatalf("the new account sees %v", teams)
		}
	})
}

// The phone app holds the same kind of token as the plugin, and deletes the
// account with it (ADR 0040); the email typed back is still the confirmation.
func TestTheAppDeletesTheAccountWithItsToken(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		b := e.admin("solo@x.io")
		app := e.pluginFor(b)
		refused(t, "the app without the confirmation", app.send("DELETE", "/api/profile", map[string]string{"confirm": "other@x.io"}), 400, "confirmation_mismatch")
		must(t, app.send("DELETE", "/api/profile", map[string]string{"confirm": "solo@x.io"}), 204)
		refused(t, "the token after the deletion", app.get("/api/profile"), 401, "unauthorized")
		refused(t, "the browser after the deletion", b.get("/api/profile"), 401, "unauthorized")
	})
}

// An admin deletes their team with everyone in it (ADR 0056): the name typed
// back confirms it, a member may not, and the members lose it at once while
// their accounts and other teams stay.
func TestDeletingATeam(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{})
		admin, _ := e.person("admin@x.io")
		member, memberID := e.person("member@x.io")
		outsider, _ := e.person("outsider@x.io")
		doomed := newTeam(t, admin, "Doomed")
		kept := newTeam(t, admin, "Kept")
		for _, id := range []string{doomed, kept} {
			_, token := invite(t, admin, id)
			must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		}
		must(t, admin.post("/api/teams/"+doomed+"/configs", map[string]any{"kind": "preset", "name": "Ours", "data": map[string]any{"inheritModel": true, "description": "Ours", "requiredTools": []string{}, "optionalTools": []string{}, "systemPrompt": "Be brief."}}), 201)
		must(t, member.post("/api/teams/"+doomed+"/submissions", map[string]any{"config": map[string]any{"kind": "preset", "name": "Draft", "data": map[string]any{"inheritModel": true}}, "baseVersion": 0, "note": ""}), 200)
		must(t, admin.send("PUT", "/api/teams/"+doomed+"/budgets", budgetBody("team", "", "10", 0)), 200)

		path := "/api/teams/" + doomed
		refused(t, "a member deleting it", member.send("DELETE", path, map[string]string{"confirm": "Doomed"}), 403, "admin_required")
		refused(t, "an outsider deleting it", outsider.send("DELETE", path, map[string]string{"confirm": "Doomed"}), 404, "team_not_found")
		refused(t, "a confirmation that is not the name", admin.send("DELETE", path, map[string]string{"confirm": "Kept"}), 400, "confirmation_mismatch")
		refused(t, "the name in another case", admin.send("DELETE", path, map[string]string{"confirm": "doomed"}), 400, "confirmation_mismatch")
		if !d.Client.Team.Query().Where(team.ID(doomed)).ExistX(ctx) {
			t.Fatal("a refused deletion changed something")
		}

		must(t, admin.send("DELETE", path, map[string]string{"confirm": " Doomed "}), 204)
		if d.Client.Team.Query().Where(team.ID(doomed)).ExistX(ctx) || d.Client.TeamConfig.Query().Where(teamconfig.TeamID(doomed)).ExistX(ctx) {
			t.Fatal("the team is still there")
		}
		if d.Client.ResourceSubmission.Query().Where(resourcesubmission.TeamID(doomed)).ExistX(ctx) || d.Client.BudgetPolicy.Query().Where(budgetpolicy.TeamID(doomed)).ExistX(ctx) {
			t.Fatal("rows of the deleted team are left behind")
		}
		refused(t, "the member after the deletion", member.get(path), 404, "team_not_found")
		refused(t, "the admin after the deletion", admin.get(path), 404, "team_not_found")
		for _, b := range []*browser{admin, member} {
			teams := jsonArray(t, b.get("/api/teams"))
			if len(teams) != 1 || teams[0].(map[string]any)["id"] != kept {
				t.Fatalf("teams left: %v", teams)
			}
		}
		if !d.Client.User.Query().Where(user.ID(memberID)).ExistX(ctx) {
			t.Fatal("the member's account went with the team")
		}
	})
}
