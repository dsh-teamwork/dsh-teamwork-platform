package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// A host token (ADR 0047) is a shared DSH's: it reaches one team's
// configuration and models and nothing else, it is no person, and its calls
// are the team's, held to the team's budgets and to no member's.
func TestHostTokenReachesOneTeamAsNoMember(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{allowPrivate: true})
		ok := func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"choices":[]}`) }
		ua, ub := newUpstream(t, ok), newUpstream(t, ok)
		admin := e.admin("owner@x.io")
		teamA, modelA := stubTeam(t, admin, ua, "sk-a")
		_, modelB := stubTeam(t, admin, ub, "sk-b")
		seal := func(p auth.Purpose, c auth.Claims) *plugin {
			token, _, err := auth.NewSealer(secret, nil).Seal(p, c, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			return &plugin{e: e, token: token}
		}
		host := seal(auth.HostBearer, auth.Claims{Sub: "host-1", Via: "host", Team: teamA})

		// It syncs its team alone, as a member sees it.
		teams := must(t, host.get("/api/configs"), 200)["teams"].([]any)
		if len(teams) != 1 || teams[0].(map[string]any)["teamId"] != teamA || teams[0].(map[string]any)["role"] != "member" {
			t.Fatalf("host token synced %v", teams)
		}

		// Its team's model answers, billed to the shared host and no member;
		// another team's is refused before any upstream is reached.
		must(t, call(host, modelA, false), 200)
		row := d.Client.UsageRequest.Query().Where(usagerequest.TeamID(teamA)).OnlyX(ctx)
		if row.HostID != "host-1" || row.UserID != "" {
			t.Fatalf("host call recorded as user %q host %q", row.UserID, row.HostID)
		}
		entries := must(t, admin.get("/api/teams/"+teamA+"/usage"), 200)["entries"].([]any)
		if v := entries[0].(map[string]any); v["hostId"] != "host-1" || v["userId"] != "" {
			t.Fatalf("usage entry %v", v)
		}
		if r := call(host, modelB, false); r.status != http.StatusForbidden || ub.hits() != 0 {
			t.Fatalf("another team's model: %d %s, upstream hits %d", r.status, r.body, ub.hits())
		}

		// A member's default budget does not hold a shared DSH; the team's does.
		must(t, admin.send("PUT", "/api/teams/"+teamA+"/budgets", budgetBody("default_member", "", "100", 0)), 200)
		refused(t, "member under a default budget", call(e.pluginFor(admin), modelA, false), 403, "budget_model_unpriced")
		must(t, call(host, modelA, false), 200)
		must(t, admin.send("PUT", "/api/teams/"+teamA+"/budgets", budgetBody("team", "", "100", 0)), 200)
		refused(t, "host under a team budget", call(host, modelA, false), 403, "budget_model_unpriced")

		// Every other route treats it as nobody.
		for _, path := range []string{"/api/profile", "/api/teams", "/api/teams/" + teamA + "/usage"} {
			if r := host.get(path); r.status != http.StatusUnauthorized {
				t.Fatalf("GET %s with a host token: %d %s", path, r.status, r.body)
			}
		}
		if r := host.post("/api/teams/"+teamA+"/configs", model("Planted")); r.status != http.StatusUnauthorized {
			t.Fatalf("a host token wrote a config: %d %s", r.status, r.body)
		}

		// One without a team, or a host's claims sealed as another kind, opens as nothing.
		if r := seal(auth.HostBearer, auth.Claims{Sub: "host-1"}).get("/api/configs"); r.status != http.StatusUnauthorized {
			t.Fatalf("a host token with no team: %d", r.status)
		}
		if r := seal(auth.ComputerBearer, auth.Claims{Sub: "host-1", Team: teamA}).get("/api/configs"); r.status != http.StatusUnauthorized {
			t.Fatalf("a host's claims as a computer token: %d", r.status)
		}

		// Its team deleted, it syncs nothing and calls nothing.
		d.Client.Team.DeleteOneID(teamA).ExecX(ctx)
		if d.Client.Team.Query().Where(team.ID(teamA)).ExistX(ctx) {
			t.Fatal("team not deleted")
		}
		if teams := must(t, host.get("/api/configs"), 200)["teams"].([]any); len(teams) != 0 {
			t.Fatalf("a deleted team's host still syncs %v", teams)
		}
		if r := call(host, modelA, false); r.status != http.StatusForbidden {
			t.Fatalf("a deleted team's host still calls: %d", r.status)
		}
	})
}
