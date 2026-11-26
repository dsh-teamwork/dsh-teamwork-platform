package httpapi_test

import (
	"context"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// Usage stats are scoped as the usage list is: a member reads their own, an
// admin the team's or one member's. Days are every calendar day of the period
// in the asked time zone; an edition's meter adds points but no calls. Members
// rank who spent the period, most points first: the team for its admin, the
// reader alone for a member.
func TestUsageStatsAreScopedAndDrawnInTheCallersZone(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{allowPrivate: true})
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"usage":`+usageFixture+`}`) })
		admin := e.admin("admin@stats.test")
		teamID, modelID := stubTeam(t, admin, u, "sk-test")
		path := "/api/teams/" + teamID
		member, memberID := e.person("member@stats.test")
		must(t, admin.post(path+"/members", map[string]string{"email": "member@stats.test"}), 201)

		// 10.2 points a call (rateBody): one for the admin, two for the member, and five points of a meter.
		must(t, call(e.pluginFor(admin), modelID, false), 200)
		must(t, call(e.pluginFor(member), modelID, false), 200)
		must(t, call(e.pluginFor(member), modelID, false), 200)
		d.Client.UsageRequest.Create().SetTeamID(teamID).SetUserID(memberID).SetSubmittedConfigID("").SetConfigID("").
			SetProvider("").SetModel("").SetStream(false).SetMeter("sandbox").SetState(usagerequest.StateSettled).SetPointUnits(5_000_000_000).ExecX(ctx)

		const zone = "Asia/Shanghai"
		mine := must(t, member.get(path+"/usage/stats?timezone="+url.QueryEscape(zone)), 200)
		totals := mine["totals"].(map[string]any)
		if totals["calls"] != float64(2) || totals["points"] != "25.4" || totals["unpriced"] != float64(0) || totals["input"] != float64(4000) ||
			totals["output"] != float64(2000) || totals["reasoning"] != float64(800) || mine["timezone"] != zone {
			t.Fatalf("a member's totals: %+v", mine)
		}
		sources := mine["sources"].([]any)
		model, meter := sources[0].(map[string]any), sources[1].(map[string]any)
		if len(sources) != 2 || model["kind"] != "model" || model["key"] != modelID || model["name"] != "Stub" || model["calls"] != float64(2) || model["points"] != "20.4" ||
			meter["kind"] != "meter" || meter["name"] != "sandbox" || meter["calls"] != float64(0) || meter["points"] != "5" {
			t.Fatalf("a member's sources: %+v", sources)
		}
		loc, _ := time.LoadLocation(zone)
		today := time.Now().In(loc).Format(time.DateOnly)
		days := mine["days"].([]any)
		if len(days) < 30 || len(days) > 31 || days[len(days)-1].(map[string]any)["day"] != today {
			t.Fatalf("the period's days in %s end %v: %d days", zone, days[len(days)-1], len(days))
		}
		if last := days[len(days)-1].(map[string]any); last["calls"] != float64(2) || last["points"] != "25.4" {
			t.Fatalf("today: %+v", last)
		}

		if got := must(t, member.get(path+"/usage/stats?userId=admin"), 200)["totals"].(map[string]any); got["calls"] != float64(2) {
			t.Fatalf("a member asking for someone else read %+v", got)
		}
		if members := mine["members"].([]any); len(members) != 1 || members[0].(map[string]any)["userId"] != memberID {
			t.Fatalf("a member's members: %+v", members)
		}
		team := must(t, admin.get(path+"/usage/stats"), 200)
		if got := team["totals"].(map[string]any); got["calls"] != float64(3) || got["points"] != "35.6" {
			t.Fatalf("the team's totals: %+v", got)
		}
		members := team["members"].([]any)
		first, second := members[0].(map[string]any), members[1].(map[string]any)
		if len(members) != 2 || first["userId"] != memberID || first["calls"] != float64(2) || first["points"] != "25.4" || first["input"] != float64(4000) ||
			second["calls"] != float64(1) || second["points"] != "10.2" {
			t.Fatalf("the team's members: %+v", members)
		}
		if got := must(t, admin.get(path+"/usage/stats?userId="+memberID), 200)["totals"].(map[string]any); got["calls"] != float64(2) {
			t.Fatalf("one member's totals for the admin: %+v", got)
		}

		long := time.Now().Add(-100 * 24 * time.Hour).UTC().Format(time.RFC3339)
		refused(t, "more than 92 days", member.get(path+"/usage/stats?since="+url.QueryEscape(long)), 400, "invalid_request")
		refused(t, "an unknown zone", member.get(path+"/usage/stats?timezone=Mars%2FBase"), 400, "invalid_request")
		outsider, _ := e.person("outsider@stats.test")
		refused(t, "outside the team", outsider.get(path+"/usage/stats"), 404, "team_not_found")
	})
}
