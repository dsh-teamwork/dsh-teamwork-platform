package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamprovider"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// publicProvider is a public address by literal IP, so the network rule
// needs no DNS (RFC 5737's documentation range); nothing here calls it.
const publicProvider = "https://203.0.113.10/v1"

const personPassword = "a person's own password"

// person adds an account with a password of its own and signs it in.
func (e *env) person(email string) (*browser, string) {
	e.t.Helper()
	ctx := context.Background()
	u := e.db.Client.User.Create().SetEmail(email).SaveX(ctx)
	e.db.Client.Identity.Create().SetProvider("email").SetSubject(email).SetUserID(u.ID).ExecX(ctx)
	hash, err := auth.HashPassword(personPassword)
	if err != nil {
		e.t.Fatal(err)
	}
	e.db.Client.Password.Create().SetUserID(u.ID).SetHash(hash).ExecX(ctx)
	b := e.browser()
	must(e.t, b.post("/api/auth/password/sign-in", map[string]string{"email": email, "password": personPassword}), 200)
	return b, u.ID
}

func (b *browser) send(method, path string, body any) response {
	return do(b.e.t, b.client, method, b.e.url+path, body, map[string]string{"Origin": b.origin})
}

func (p *plugin) send(method, path string, body any) response {
	return do(p.e.t, http.DefaultClient, method, p.e.url+path, body, map[string]string{"Authorization": "Bearer " + p.token})
}

// refused asserts a refusal by status and code.
func refused(t *testing.T, what string, r response, status int, code string) {
	t.Helper()
	if r.status != status || r.code() != code {
		t.Fatalf("%s: %d %s, want %d %s", what, r.status, r.body, status, code)
	}
}

func newTeam(t *testing.T, b *browser, name string) string {
	t.Helper()
	return must(t, b.post("/api/teams", map[string]string{"name": name}), 201)["id"].(string)
}

func addProvider(t *testing.T, b *browser, teamID string) {
	t.Helper()
	must(t, b.post("/api/teams/"+teamID+"/providers", map[string]string{"name": "deepseek", "baseUrl": publicProvider, "apiKey": "sk-test"}), 201)
}

func model(name string) map[string]any {
	return map[string]any{"kind": "model", "name": name, "data": map[string]any{"provider": "deepseek", "model": "chat"}}
}

func invite(t *testing.T, admin *browser, teamID string) (id, token string) {
	t.Helper()
	v := must(t, admin.post("/api/teams/"+teamID+"/invites", nil), 201)
	return v["id"].(string), v["token"].(string)
}

func configIDs(t *testing.T, r response) []string {
	t.Helper()
	var ids []string
	for _, c := range jsonArray(t, r) {
		ids = append(ids, c.(map[string]any)["id"].(string))
	}
	sort.Strings(ids)
	return ids
}

func jsonArray(t *testing.T, r response) []any {
	t.Helper()
	if r.status != 200 {
		t.Fatalf("status %d: %s", r.status, r.body)
	}
	var v []any
	if err := json.Unmarshal(r.body, &v); err != nil {
		t.Fatalf("not a JSON array: %s", r.body)
	}
	return v
}

func TestInvitedMemberReadsButCannotWriteUntilRemoved(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		member, memberID := e.person("member@x.io")
		outsider, _ := e.person("outsider@x.io")
		teamID := newTeam(t, admin, "Test team")
		addProvider(t, admin, teamID)

		_, token := invite(t, admin, teamID)
		if v := must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200); v["teamId"] != teamID {
			t.Fatalf("redeemed into %v", v)
		}
		refused(t, "a spent invitation", outsider.post("/api/invites/redeem", map[string]string{"token": token}), 409, "invite_used")

		refused(t, "a member publishing", member.post("/api/teams/"+teamID+"/configs", model("Protected")), 403, "admin_required")
		config := must(t, admin.post("/api/teams/"+teamID+"/configs", model("Protected")), 201)
		if ids := configIDs(t, member.get("/api/teams/"+teamID+"/configs")); len(ids) != 1 || ids[0] != config["id"] {
			t.Fatalf("member reads %v", ids)
		}
		if role := must(t, member.get("/api/teams/"+teamID), 200)["role"]; role != "member" {
			t.Fatalf("member's role: %v", role)
		}
		refused(t, "an outsider reading", outsider.get("/api/teams/"+teamID+"/configs"), 404, "team_not_found")

		path := "/api/teams/" + teamID + "/configs/" + config["id"].(string)
		renamed := model("Protected v2")
		renamed["version"] = 1
		if v := must(t, admin.send("PATCH", path, renamed), 200); v["version"] != float64(2) || v["name"] != "Protected v2" {
			t.Fatalf("patched: %v", v)
		}
		stale := model("Protected")
		stale["version"] = 1
		refused(t, "a stale version", admin.send("PATCH", path, stale), 409, "config_conflict")
		refused(t, "a second config of one name", admin.post("/api/teams/"+teamID+"/configs", model("Protected v2")), 409, "config_exists")
		other := must(t, admin.post("/api/teams/"+teamID+"/configs", model("Other")), 201)
		onto := model("Protected v2")
		onto["version"] = 1
		refused(t, "a rename onto an existing name", admin.send("PATCH", "/api/teams/"+teamID+"/configs/"+other["id"].(string), onto), 409, "config_exists")

		refused(t, "the admin leaving", admin.send("DELETE", "/api/teams/"+teamID+"/membership", nil), 400, "admin_cannot_leave")
		must(t, admin.send("DELETE", "/api/teams/"+teamID+"/members/"+memberID, nil), 204)
		refused(t, "a removed member reading", member.get("/api/teams/"+teamID+"/configs"), 404, "team_not_found")
	})
}

func TestTeamNotInAnswersAsTeamThatDoesNotExist(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		outsider, _ := e.person("outsider@x.io")
		teamID := newTeam(t, admin, "Test team")
		for _, id := range []string{teamID, "no-such-team"} {
			base := "/api/teams/" + id
			for what, r := range map[string]response{
				"team":          outsider.get(base),
				"configs":       outsider.get(base + "/configs"),
				"create config": outsider.post(base+"/configs", model("Intruder")),
				"providers":     outsider.get(base + "/providers"),
				"invite":        outsider.post(base+"/invites", nil),
				"leave":         outsider.send("DELETE", base+"/membership", nil),
			} {
				refused(t, id+" "+what, r, 404, "team_not_found")
			}
		}
	})
}

func TestAnotherTeamsAdminCannotTouchThisTeamsConfig(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Test team")
		addProvider(t, admin, teamID)
		own := must(t, admin.post("/api/teams/"+teamID+"/configs", model("Isolated")), 201)["id"].(string)

		other, _ := e.person("other@x.io")
		elsewhere := newTeam(t, other, "Other team")
		addProvider(t, other, elsewhere)
		hijack := model("Hijacked")
		hijack["version"] = 1
		refused(t, "a config of another team, patched", other.send("PATCH", "/api/teams/"+elsewhere+"/configs/"+own, hijack), 409, "config_conflict")
		must(t, other.send("DELETE", "/api/teams/"+elsewhere+"/configs/"+own, nil), 204)
		configs := jsonArray(t, admin.get("/api/teams/"+teamID+"/configs"))
		if len(configs) != 1 || configs[0].(map[string]any)["name"] != "Isolated" {
			t.Fatalf("this team's configs after another admin's writes: %v", configs)
		}
		if got := jsonArray(t, other.get("/api/teams/"+elsewhere+"/configs")); len(got) != 0 {
			t.Fatalf("the other team gained %v", got)
		}
	})
}

func TestInvitationRaceAdmitsOneAndRevokedAdmitsNone(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Test team")
		a, _ := e.person("race-a@x.io")
		b, _ := e.person("race-b@x.io")
		c, _ := e.person("race-c@x.io")

		_, token := invite(t, admin, teamID)
		results := make([]response, 2)
		var wg sync.WaitGroup
		for i, racer := range []*browser{a, b} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results[i] = racer.post("/api/invites/redeem", map[string]string{"token": token})
			}()
		}
		wg.Wait()
		joined, used := 0, 0
		for _, r := range results {
			switch {
			case r.status == 200:
				joined++
			case r.status == 409 && r.code() == "invite_used":
				used++
			default:
				t.Errorf("a racer got %d %s", r.status, r.body)
			}
		}
		if joined != 1 || used != 1 {
			t.Fatalf("%d joined, %d refused invite_used", joined, used)
		}
		if n := len(must(t, admin.get("/api/teams/"+teamID), 200)["members"].([]any)); n != 2 {
			t.Fatalf("%d members after the race", n)
		}

		revokedID, revoked := invite(t, admin, teamID)
		must(t, admin.send("DELETE", "/api/teams/"+teamID+"/invites/"+revokedID, nil), 204)
		refused(t, "a revoked invitation", c.post("/api/invites/redeem", map[string]string{"token": revoked}), 400, "invite_invalid")
	})
}

func TestPresetReferencesMustBeThisTeamsAtThatVersion(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Test team")
		addProvider(t, admin, teamID)
		configs := "/api/teams/" + teamID + "/configs"
		plugin := must(t, admin.post(configs, map[string]any{"kind": "plugin", "name": "Tool", "data": map[string]any{"package": "@a/tool", "version": "1.0.0"}}), 201)["id"].(string)
		preset := func(modelID string, deps ...map[string]any) map[string]any {
			data := map[string]any{"modelConfigId": modelID}
			if deps != nil {
				data["pluginDependencies"] = deps
			}
			return map[string]any{"kind": "preset", "name": "Review", "data": data}
		}
		pin := func(id, version string) map[string]any {
			return map[string]any{"pluginConfigId": id, "version": version}
		}

		refused(t, "a missing model", admin.post(configs, preset("missing")), 400, "model_not_found")
		target := must(t, admin.post(configs, model("Target")), 201)["id"].(string)
		refused(t, "a pin at the wrong version", admin.post(configs, preset(target, pin(plugin, "2.0.0"))), 400, "plugin_dependency_invalid")

		// Another team's model and plugin are not this team's, whatever their ids.
		other, _ := e.person("other@x.io")
		elsewhere := newTeam(t, other, "Other team")
		addProvider(t, other, elsewhere)
		theirModel := must(t, other.post("/api/teams/"+elsewhere+"/configs", model("Theirs")), 201)["id"].(string)
		theirPlugin := must(t, other.post("/api/teams/"+elsewhere+"/configs", map[string]any{"kind": "plugin", "name": "Tool", "data": map[string]any{"package": "@a/tool", "version": "1.0.0"}}), 201)["id"].(string)
		refused(t, "another team's model", admin.post(configs, preset(theirModel)), 400, "model_not_found")
		refused(t, "another team's plugin", admin.post(configs, preset(target, pin(theirPlugin, "1.0.0"))), 400, "plugin_dependency_invalid")

		ok := must(t, admin.post(configs, preset(target, pin(plugin, "1.0.0"))), 201)
		if ok["kind"] != "preset" {
			t.Fatalf("preset: %v", ok)
		}
		// What a preset uses stays until the preset changes.
		refused(t, "a model a preset uses", admin.send("DELETE", configs+"/"+target, nil), 409, "model_in_use")
		refused(t, "a plugin a preset pins", admin.send("DELETE", configs+"/"+plugin, nil), 409, "plugin_in_use")
		for _, id := range []string{ok["id"].(string), target, plugin} {
			must(t, admin.send("DELETE", configs+"/"+id, nil), 204)
		}
		if ids := configIDs(t, admin.get(configs)); len(ids) != 0 {
			t.Fatalf("left after deleting: %v", ids)
		}
	})
}

func TestOnePersonInSeveralTeams(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		colleague := e.admin("colleague@x.io")
		person, _ := e.person("person@x.io")
		own := newTeam(t, person, "Own team")
		joined := newTeam(t, colleague, "Joined team")
		_, token := invite(t, colleague, joined)
		must(t, person.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		addProvider(t, person, own)
		addProvider(t, colleague, joined)

		t.Run("lists every team with the role held in each", func(t *testing.T) {
			got := jsonArray(t, person.get("/api/teams"))
			want := []map[string]any{
				{"id": own, "name": "Own team", "role": "admin", "memberCount": float64(1)},
				{"id": joined, "name": "Joined team", "role": "member", "memberCount": float64(2)},
			}
			if len(got) != len(want) {
				t.Fatalf("teams: %v", got)
			}
			for i, w := range want {
				for k, v := range w {
					if got[i].(map[string]any)[k] != v {
						t.Fatalf("team %d: %v, want %v", i, got[i], w)
					}
				}
			}
		})

		var theirs string
		t.Run("pairs an admin check with the team it acts on", func(t *testing.T) {
			refused(t, "a member of joined publishing there", person.post("/api/teams/"+joined+"/configs", model("Shared name")), 403, "admin_required")
			mine := must(t, person.post("/api/teams/"+own+"/configs", model("Shared name")), 201)["id"].(string)
			if row := d.Client.TeamConfig.GetX(context.Background(), mine); row.TeamID != own {
				t.Fatalf("written to team %s", row.TeamID)
			}
			// The admin of own naming a config of joined: scoped to own, so nothing happens.
			theirs = must(t, colleague.post("/api/teams/"+joined+"/configs", model("Shared name")), 201)["id"].(string)
			must(t, person.send("DELETE", "/api/teams/"+own+"/configs/"+theirs, nil), 204)
			if n := d.Client.TeamConfig.Query().Where(teamconfig.ID(theirs)).CountX(context.Background()); n != 1 {
				t.Fatal("another team's config was deleted")
			}
		})

		t.Run("gives the plugin every team with its own configuration and role", func(t *testing.T) {
			snap := must(t, e.pluginFor(person).get("/api/configs"), 200)["teams"].([]any)
			if len(snap) != 2 {
				t.Fatalf("snapshot: %v", snap)
			}
			for i, want := range [][3]string{{own, "Own team", "admin"}, {joined, "Joined team", "member"}} {
				entry := snap[i].(map[string]any)
				if entry["teamId"] != want[0] || entry["teamName"] != want[1] || entry["role"] != want[2] {
					t.Fatalf("team %d: %v, want %v", i, entry, want)
				}
				var ids []string
				for _, c := range entry["configs"].([]any) {
					ids = append(ids, c.(map[string]any)["id"].(string))
				}
				sort.Strings(ids)
				stored := d.Client.TeamConfig.Query().Where(teamconfig.TeamID(want[0])).IDsX(context.Background())
				sort.Strings(stored)
				if strings.Join(ids, ",") != strings.Join(stored, ",") || len(ids) == 0 {
					t.Fatalf("team %s configs %v, stored %v", want[0], ids, stored)
				}
			}
			nobody, _ := e.person("nobody@x.io")
			if teams := must(t, e.pluginFor(nobody).get("/api/configs"), 200)["teams"].([]any); len(teams) != 0 {
				t.Fatalf("a person in no team: %v", teams)
			}
		})

		t.Run("refuses a second seat and leaves the invitation unspent", func(t *testing.T) {
			id, token := invite(t, colleague, joined)
			refused(t, "a second seat", person.post("/api/invites/redeem", map[string]string{"token": token}), 409, "already_in_team")
			for _, inv := range jsonArray(t, colleague.get("/api/teams/"+joined+"/invites")) {
				if m := inv.(map[string]any); m["id"] == id && m["usedAt"] != nil {
					t.Fatalf("the invitation was spent: %v", m)
				}
			}
		})

		t.Run("leaving one team keeps the others", func(t *testing.T) {
			must(t, person.send("DELETE", "/api/teams/"+joined+"/membership", nil), 204)
			got := jsonArray(t, person.get("/api/teams"))
			if len(got) != 1 || got[0].(map[string]any)["id"] != own {
				t.Fatalf("teams after leaving: %v", got)
			}
		})
	})
}

var firstPassword = regexp.MustCompile(`^[\w-]{20}$`)

// signIn signs an account in with a password, returning the browser and
// the mustChangePassword answer.
func (e *env) signIn(email, password string) (*browser, response) {
	b := e.browser()
	return b, b.post("/api/auth/password/sign-in", map[string]string{"email": email, "password": password})
}

func TestAdminCreatedAccounts(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Accounts team")
		members := "/api/teams/" + teamID + "/members"

		t.Run("creates a member with a first password shown once that must be changed", func(t *testing.T) {
			added := must(t, admin.post(members, map[string]string{"email": "NEW@X.IO"}), 201)
			pw, _ := added["password"].(string)
			if added["email"] != "new@x.io" || !firstPassword.MatchString(pw) {
				t.Fatalf("added: %v", added)
			}
			b, r := e.signIn("new@x.io", pw)
			if v := must(t, r, 200); v["mustChangePassword"] != true {
				t.Fatalf("sign-in: %v", v)
			}
			if u := must(t, b.get("/api/auth/session"), 200)["user"].(map[string]any); u["mustChangePassword"] != true {
				t.Fatalf("session: %v", u)
			}
			refused(t, "before the change", b.get("/api/teams/"+teamID), 403, "password_change_required")
			must(t, b.post("/api/auth/password/change", map[string]string{"current": pw, "next": "my own new password"}), 204)
			if role := must(t, b.get("/api/teams/"+teamID), 200)["role"]; role != "member" {
				t.Fatalf("role: %v", role)
			}
			if r := admin.post(members, map[string]string{"email": "new@x.io"}); r.status != 409 || r.code() != "member_in_team" {
				t.Fatalf("added twice: %d %s", r.status, r.body)
			}
		})

		t.Run("adds an existing account as it is whatever other teams it is in", func(t *testing.T) {
			first := must(t, admin.post(members, map[string]string{"email": "existing@x.io"}), 201)
			userID, pw := first["userId"].(string), first["password"].(string)
			must(t, admin.send("DELETE", members+"/"+userID, nil), 204)
			again := must(t, admin.post(members, map[string]string{"email": "existing@x.io"}), 201)
			if again["userId"] != userID || again["password"] != nil {
				t.Fatalf("added again: %v", again)
			}
			otherAdmin, _ := e.person("other-admin@x.io")
			other := newTeam(t, otherAdmin, "Accounts elsewhere")
			elsewhere := must(t, otherAdmin.post("/api/teams/"+other+"/members", map[string]string{"email": "existing@x.io"}), 201)
			if elsewhere["userId"] != userID || elsewhere["password"] != nil {
				t.Fatalf("added elsewhere: %v", elsewhere)
			}
			b, r := e.signIn("existing@x.io", pw)
			must(t, r, 200)
			must(t, b.post("/api/auth/password/change", map[string]string{"current": pw, "next": "my own new password"}), 204)
			var ids []string
			for _, tm := range jsonArray(t, b.get("/api/teams")) {
				ids = append(ids, tm.(map[string]any)["id"].(string))
			}
			want := []string{teamID, other}
			sort.Strings(ids)
			sort.Strings(want)
			if strings.Join(ids, ",") != strings.Join(want, ",") {
				t.Fatalf("teams %v, want %v", ids, want)
			}
		})

		t.Run("resets only a member of the admin's own team and the old password stops working", func(t *testing.T) {
			added := must(t, admin.post(members, map[string]string{"email": "reset@x.io"}), 201)
			userID, old := added["userId"].(string), added["password"].(string)
			reset := must(t, admin.post(members+"/"+userID+"/password", nil), 200)["password"].(string)
			if reset == old || !firstPassword.MatchString(reset) {
				t.Fatalf("reset to %q from %q", reset, old)
			}
			_, r := e.signIn("reset@x.io", old)
			refused(t, "the old password", r, 401, "invalid_credentials")
			b, r := e.signIn("reset@x.io", reset)
			if v := must(t, r, 200); v["mustChangePassword"] != true {
				t.Fatalf("new password sign-in: %v", v)
			}
			must(t, b.post("/api/auth/password/change", map[string]string{"current": reset, "next": "my own new password"}), 204)

			adminID := must(t, admin.get("/api/profile"), 200)["id"].(string)
			refused(t, "the admin's own", admin.post(members+"/"+adminID+"/password", nil), 400, "cannot_reset_self")
			refused(t, "a member resetting", b.post(members+"/"+adminID+"/password", nil), 403, "admin_required")
			refused(t, "a member adding", b.post(members, map[string]string{"email": "x@x.io"}), 403, "admin_required")
			_, strangerID := e.person("stranger@x.io")
			refused(t, "a stranger", admin.post(members+"/"+strangerID+"/password", nil), 404, "not_a_member")
		})

		t.Run("never resets someone also in another team", func(t *testing.T) {
			victim, victimID := e.person("victim@x.io")
			newTeam(t, victim, "Victim team")
			added := must(t, admin.post(members, map[string]string{"email": "victim@x.io"}), 201)
			if added["userId"] != victimID || added["password"] != nil {
				t.Fatalf("added: %v", added)
			}
			refused(t, "a member of another team", admin.post(members+"/"+victimID+"/password", nil), 403, "member_in_other_team")
			b, r := e.signIn("victim@x.io", personPassword)
			if v := must(t, r, 200); v["mustChangePassword"] != false {
				t.Fatalf("victim's own password: %v", v)
			}
			if n := len(jsonArray(t, b.get("/api/teams"))); n != 2 {
				t.Fatalf("victim in %d teams", n)
			}
		})
	})
}

// Where the instance sends email, people join by invitation and no admin
// sets anybody's password.
func TestAdminAccountsAreOffWhereTheInstanceSendsEmail(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{smtp: "smtp://x"})
		ctx := context.Background()
		u := d.Client.User.Create().SetEmail("admin@x.io").SaveX(ctx)
		d.Client.Identity.Create().SetProvider("email").SetSubject("admin@x.io").SetUserID(u.ID).ExecX(ctx)
		token, _, err := auth.NewSealer(secret, nil).Seal(auth.PluginBearer, auth.Claims{Sub: u.ID, Via: "email"}, auth.SessionTTL)
		if err != nil {
			t.Fatal(err)
		}
		p := &plugin{e: e, token: token}
		teamID := must(t, p.post("/api/teams", map[string]string{"name": "T"}), 201)["id"].(string)
		refused(t, "adding a member", p.post("/api/teams/"+teamID+"/members", map[string]string{"email": "m@x.io"}), 400, "passwords_off")
		refused(t, "resetting a password", p.post("/api/teams/"+teamID+"/members/"+u.ID+"/password", nil), 400, "passwords_off")
		if n := d.Client.User.Query().CountX(ctx); n != 1 {
			t.Fatalf("%d accounts", n)
		}
	})
}

func TestTeamProviders(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Providers team")
		providers := "/api/teams/" + teamID + "/providers"
		member, _ := e.person("member@x.io")
		_, token := invite(t, admin, teamID)
		must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		other, _ := e.person("other@x.io")
		elsewhere := newTeam(t, other, "Providers elsewhere")

		var ownID string
		t.Run("keeps the key sealed, bound to the team, and out of every answer", func(t *testing.T) {
			r := admin.post(providers, map[string]string{"name": "deepseek", "baseUrl": publicProvider, "apiKey": "sk-secret-value"})
			created := must(t, r, 201)
			ownID = created["id"].(string)
			if len(created) != 4 || created["name"] != "deepseek" || created["baseUrl"] != publicProvider || created["updatedAt"] == nil {
				t.Fatalf("created: %s", r.body)
			}
			row := d.Client.TeamProvider.GetX(ctx, ownID)
			if !strings.HasPrefix(row.KeyCipher, "v1.") || strings.Contains(row.KeyCipher, "sk-secret-value") {
				t.Fatalf("stored key: %s", row.KeyCipher)
			}
			if l := admin.get(providers); l.status != 200 || strings.Contains(string(l.body), "sk-secret") {
				t.Fatalf("list: %d %s", l.status, l.body)
			}
			refused(t, "a second provider of one name", admin.post(providers, map[string]string{"name": "deepseek", "baseUrl": publicProvider, "apiKey": "k"}), 409, "provider_exists")

			// The row copied under another team, with a model there calling it:
			// the key does not open, so the call stops before the network.
			d.Client.TeamProvider.Create().SetTeamID(elsewhere).SetName(row.Name).SetBaseURL(row.BaseURL).SetKeyCipher(row.KeyCipher).ExecX(ctx)
			m := must(t, other.post("/api/teams/"+elsewhere+"/configs", model("Copied")), 201)["id"].(string)
			r = e.pluginFor(other).post("/api/llm/chat/completions", map[string]any{"model": m, "messages": []any{map[string]string{"role": "user", "content": "hi"}}})
			refused(t, "a key copied to another team", r, 503, "provider_keys_unavailable")
			d.Client.TeamProvider.Delete().Where(teamprovider.TeamID(elsewhere)).ExecX(ctx)
			d.Client.TeamConfig.Delete().Where(teamconfig.TeamID(elsewhere)).ExecX(ctx)
		})

		t.Run("is for the admin of the same team only", func(t *testing.T) {
			refused(t, "a member listing", member.get(providers), 403, "admin_required")
			refused(t, "a member adding", member.post(providers, map[string]string{"name": "mine", "baseUrl": publicProvider, "apiKey": "k"}), 403, "admin_required")
			refused(t, "another team's admin moving it", other.send("PUT", "/api/teams/"+elsewhere+"/providers/"+ownID, map[string]string{"baseUrl": "https://203.0.113.11/v1"}), 404, "provider_not_configured")
			must(t, other.send("DELETE", "/api/teams/"+elsewhere+"/providers/"+ownID, nil), 204)
			if row := d.Client.TeamProvider.GetX(ctx, ownID); row.BaseURL != publicProvider {
				t.Fatalf("moved by another team: %s", row.BaseURL)
			}
		})

		t.Run("moves an address or replaces the key, keeping the name", func(t *testing.T) {
			before := d.Client.TeamProvider.GetX(ctx, ownID)
			moved := must(t, admin.send("PUT", providers+"/"+ownID, map[string]string{"baseUrl": "https://203.0.113.12/v1"}), 200)
			if moved["name"] != "deepseek" || moved["baseUrl"] != "https://203.0.113.12/v1" {
				t.Fatalf("moved: %v", moved)
			}
			if d.Client.TeamProvider.GetX(ctx, ownID).KeyCipher != before.KeyCipher {
				t.Fatal("moving the address changed the key")
			}
			must(t, admin.send("PUT", providers+"/"+ownID, map[string]string{"baseUrl": "https://203.0.113.12/v1", "apiKey": "sk-rotated"}), 200)
			after := d.Client.TeamProvider.GetX(ctx, ownID)
			if after.KeyCipher == before.KeyCipher || after.Name != "deepseek" {
				t.Fatalf("rotated: %s %s", after.Name, after.KeyCipher)
			}
		})

		t.Run("refuses an address with credentials, a query, another scheme, or one the rule forbids", func(t *testing.T) {
			for _, url := range []string{"https://user:pass@203.0.113.10/v1", "https://203.0.113.10/v1?key=x", "ftp://203.0.113.10/v1"} {
				refused(t, url, admin.post(providers, map[string]string{"name": "bad", "baseUrl": url, "apiKey": "k"}), 400, "invalid_request")
				refused(t, "PUT "+url, admin.send("PUT", providers+"/"+ownID, map[string]string{"baseUrl": url}), 400, "invalid_request")
			}
			for _, url := range []string{"https://127.0.0.1/v1", "https://169.254.169.254/v1", "http://10.0.0.5/v1"} {
				refused(t, url, admin.post(providers, map[string]string{"name": "bad", "baseUrl": url, "apiKey": "k"}), 400, "provider_address_refused")
				refused(t, "PUT "+url, admin.send("PUT", providers+"/"+ownID, map[string]string{"baseUrl": url}), 400, "provider_address_refused")
			}
		})

		t.Run("is required by a team model and cannot be removed while one calls it", func(t *testing.T) {
			configs := "/api/teams/" + teamID + "/configs"
			absent := map[string]any{"kind": "model", "name": "Calls absent", "data": map[string]any{"provider": "absent", "model": "chat"}}
			refused(t, "a model calling no provider", admin.post(configs, absent), 400, "provider_not_configured")
			config := must(t, admin.post(configs, model("Calls deepseek")), 201)["id"].(string)
			refused(t, "a provider a model calls", admin.send("DELETE", providers+"/"+ownID, nil), 409, "provider_in_use")
			must(t, admin.send("DELETE", configs+"/"+config, nil), 204)
			must(t, admin.send("DELETE", providers+"/"+ownID, nil), 204)
			if l := jsonArray(t, admin.get(providers)); len(l) != 0 {
				t.Fatalf("providers left: %v", l)
			}
		})
	})
}
