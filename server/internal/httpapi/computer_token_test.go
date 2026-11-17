package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// A computer token (ADR 0038) reaches one team's configuration and models,
// and nothing else, so an agent that reads it from a cloud computer can do no
// more than the computer's DSH needs.
func TestComputerTokenReachesOneTeamsConfigsAndModelsOnly(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		ok := func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"choices":[]}`) }
		ua, ub := newUpstream(t, ok), newUpstream(t, ok)
		e.admin("owner@x.io")
		b, userID := e.person("member@x.io")
		teamA, modelA := stubTeam(t, b, ua, "sk-a")
		_, modelB := stubTeam(t, b, ub, "sk-b")
		seal := func(p auth.Purpose, c auth.Claims, ttl time.Duration) *plugin {
			token, _, err := auth.NewSealer(secret, nil).Seal(p, c, ttl)
			if err != nil {
				t.Fatal(err)
			}
			return &plugin{e: e, token: token}
		}
		computer := seal(auth.ComputerBearer, auth.Claims{Sub: userID, Via: "computer", Team: teamA, Host: "session-1"}, time.Hour)

		// The configuration it syncs is its team's alone.
		snap := must(t, computer.get("/api/configs"), 200)
		teams := snap["teams"].([]any)
		if len(teams) != 1 || teams[0].(map[string]any)["teamId"] != teamA {
			t.Fatalf("computer token synced %v", teams)
		}
		if n := len(must(t, e.pluginFor(b).get("/api/configs"), 200)["teams"].([]any)); n != 2 {
			t.Fatalf("the member's own plugin token sees %d teams", n)
		}

		// Its team's model answers; the member's other team's model is refused.
		must(t, call(computer, modelA, false), 200)
		if r := call(computer, modelB, false); r.status != http.StatusForbidden || ub.hits() != 0 {
			t.Fatalf("another team's model: %d %s, upstream hits %d", r.status, r.body, ub.hits())
		}

		// Every other route treats it as nobody.
		for _, path := range []string{"/api/profile", "/api/teams", "/api/teams/" + teamA + "/usage"} {
			if r := computer.get(path); r.status != http.StatusUnauthorized {
				t.Fatalf("GET %s with a computer token: %d %s", path, r.status, r.body)
			}
		}
		if r := computer.post("/api/teams/"+teamA+"/configs", model("Planted")); r.status != http.StatusUnauthorized {
			t.Fatalf("a computer token wrote a config: %d %s", r.status, r.body)
		}

		// A computer token without a team, or sealed as a plugin token's kind, opens as nothing here.
		if r := seal(auth.ComputerBearer, auth.Claims{Sub: userID}, time.Hour).get("/api/configs"); r.status != http.StatusUnauthorized {
			t.Fatalf("a computer token with no team: %d", r.status)
		}
		if r := seal(auth.Session, auth.Claims{Sub: userID, Team: teamA}, time.Hour).get("/api/configs"); r.status != http.StatusUnauthorized {
			t.Fatalf("a session sealed as a Bearer: %d", r.status)
		}

		// Membership is re-read: removed from the team, it syncs nothing and calls nothing.
		d.Client.Membership.Delete().Where(membership.UserID(userID), membership.TeamID(teamA)).ExecX(context.Background())
		if teams := must(t, computer.get("/api/configs"), 200)["teams"].([]any); len(teams) != 0 {
			t.Fatalf("a removed member's computer still syncs %v", teams)
		}
		if r := call(computer, modelA, false); r.status != http.StatusForbidden {
			t.Fatalf("a removed member's computer still calls: %d", r.status)
		}
	})
}
