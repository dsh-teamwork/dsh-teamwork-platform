package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// The overview's summary counts what waits on the caller: an admin sees the
// team's calls, reviews, unresolved usage and budgets; a member sees only their
// own calls and submissions, and the limits that apply to them.
func TestTeamSummaryIsScopedToTheCaller(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{allowPrivate: true})
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"usage":`+usageFixture+`}`) })
		admin := e.admin("admin@summary.test")
		teamID, modelID := stubTeam(t, admin, u, "sk-test")
		path := "/api/teams/" + teamID
		member, memberID := e.person("member@summary.test")
		must(t, admin.post(path+"/members", map[string]string{"email": "member@summary.test"}), 201)

		empty := must(t, admin.get(path+"/summary"), 200)
		if empty["calls"] != float64(0) || empty["points"] != "0" || empty["pendingReviews"] != float64(0) || len(empty["nearLimit"].([]any)) != 0 {
			t.Fatalf("a new team's summary: %+v", empty)
		}

		// One priced call each, 10.2 points apiece; then the member's is left for an admin to resolve.
		must(t, admin.send("PUT", path+"/model-rates/"+modelID, rateBody(0, "2")), 200)
		must(t, call(e.pluginFor(admin), modelID, false), 200)
		must(t, call(e.pluginFor(member), modelID, false), 200)
		d.Client.UsageRequest.Update().Where(usagerequest.UserID(memberID)).SetState(usagerequest.StatePending).ExecX(ctx)

		// A member's submission waiting for review.
		preset := map[string]any{"kind": "preset", "name": "Review", "data": map[string]any{"inheritModel": true, "systemPrompt": "Review carefully"}}
		draft := must(t, member.post(path+"/submissions", map[string]any{"config": preset, "baseVersion": 0, "note": "Please review"}), 200)
		must(t, member.post(path+"/submissions/"+draft["id"].(string)+"/submit", map[string]any{"revision": draft["revision"]}), 200)

		// A team cap of 100 points with 90 already spent this month: past the 80% notice.
		must(t, admin.send("PUT", path+"/budgets", budgetBody("team", "", "100", 0)), 200)
		now := time.Now().UTC()
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		d.Client.BudgetWindow.Create().SetTeamID(teamID).SetScope(budgetwindow.ScopeTeam).SetPeriod(budgetwindow.PeriodMonth).
			SetStartsAt(start).SetEndsAt(start.AddDate(0, 1, 0)).SetSpentUnits(90_000_000_000).ExecX(ctx)

		got := must(t, admin.get(path+"/summary"), 200)
		if got["calls"] != float64(2) || got["points"] != "20.4" || got["unpriced"] != float64(1) || got["unresolved"] != float64(1) ||
			got["pendingReviews"] != float64(1) || got["failedNotices"] != float64(0) {
			t.Fatalf("admin summary: %+v", got)
		}
		near := got["nearLimit"].([]any)
		if len(near) != 1 {
			t.Fatalf("admin near-limit windows: %+v", near)
		}
		if w := near[0].(map[string]any); w["scope"] != "team" || w["period"] != "month" || w["threshold"] != float64(80) {
			t.Fatalf("team window: %+v", w)
		}

		mine := must(t, member.get(path+"/summary"), 200)
		if mine["calls"] != float64(1) || mine["points"] != "10.2" || mine["unresolved"] != float64(0) || mine["pendingReviews"] != float64(1) ||
			len(mine["nearLimit"].([]any)) != 1 {
			t.Fatalf("member summary: %+v", mine)
		}
		if b := mine["budget"].(map[string]any); b["state"] != "known" {
			t.Fatalf("member budget: %+v", b)
		}

		outsider, _ := e.person("outsider@summary.test")
		refused(t, "outside team", outsider.get(path+"/summary"), 404, "team_not_found")
	})
}
