package httpapi_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

type budgetTransport func(*http.Request) (*http.Response, error)

func (f budgetTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func budgetBody(scope, subject, points string, revision int) map[string]any {
	return map[string]any{"scope": scope, "subjectId": subject, "points": points, "revision": revision,
		"period": "month", "timezone": "UTC", "enabled": true, "notify": "admins"}
}

// Drive the authenticated gateway while two responses are held upstream. Admins
// have the same budget restrictions as members; no real provider call is made.
func TestBudgetGatewayConcurrentReservationsAndPolicyEdits(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		resume := make(chan struct{})
		defer close(resume)
		var hits atomic.Int32
		transport := budgetTransport(func(r *http.Request) (*http.Response, error) {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				return nil, err
			}
			if r.URL.Host != "api.deepseek.com" || body["max_tokens"] != float64(20) || body["max_completion_tokens"] != nil {
				return nil, fmt.Errorf("unbounded or wrong upstream: %s %+v", r.URL, body)
			}
			hits.Add(1)
			select {
			case <-resume:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))}, nil
		})
		e := start(t, d, options{gatewayClient: &http.Client{Transport: transport}, lookup: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("203.0.113.10")}, nil
		}})
		admin := e.admin("admin@budget.test")
		teamID := newTeam(t, admin, "Budget team")
		path := "/api/teams/" + teamID
		must(t, admin.post(path+"/providers", map[string]string{"name": "direct", "baseUrl": "https://api.deepseek.com", "apiKey": "sk-fake"}), 201)
		modelID := must(t, admin.post(path+"/configs", map[string]any{"kind": "model", "name": "Flash", "data": map[string]any{"provider": "direct", "model": "deepseek-flash", "maxTokens": 20}}), 201)["id"].(string)
		rate := map[string]any{"revision": 0, "basis": "cost", "input": "1", "cacheRead": "1", "cacheWrite": "0", "output": "1"}
		must(t, admin.send("PUT", path+"/model-rates/"+modelID, rate), 200)
		// Each call reserves 1048.596 points (full context plus 20 output).
		must(t, admin.send("PUT", path+"/budgets", budgetBody("team", "", "2097.192", 0)), 200)
		plugin := e.pluginFor(admin)
		done := make(chan response, 20)
		for range 20 {
			go func() { done <- call(plugin, modelID, false) }()
		}
		for range 18 {
			select {
			case result := <-done:
				refused(t, "concurrent cap", result, 403, "budget_exhausted")
				if v := result.json(t); v["scope"] != "team" || v["resetAt"] == nil {
					t.Fatalf("missing limit metadata: %+v", v)
				}
			case <-time.After(20 * time.Second):
				t.Fatal("admissions stalled")
			}
		}
		if hits.Load() != 2 || d.Client.UsageRequest.Query().CountX(ctx) != 2 {
			t.Fatal("rejected calls reached upstream or created accounting rows")
		}
		// Lowering the cap preserves the active reservations.
		must(t, admin.send("PUT", path+"/budgets", budgetBody("team", "", "1", 1)), 200)
		refused(t, "stale policy", admin.send("PUT", path+"/budgets", budgetBody("team", "", "9999", 1)), 409, "budget_changed")
		if w := d.Client.BudgetWindow.Query().OnlyX(ctx); w.ReservedUnits != 2097192000000 {
			t.Fatalf("edit reset holds: %+v", w)
		}
		// A separate close keeps the deferred cleanup safe on assertion failures.
		for range 2 {
			resume <- struct{}{}
		}
		for range 2 {
			select {
			case result := <-done:
				must(t, result, 200)
			case <-time.After(20 * time.Second):
				t.Fatal("settlement stalled")
			}
		}
		if w := d.Client.BudgetWindow.Query().OnlyX(ctx); w.ReservedUnits != 0 || w.SpentUnits != 30000000 {
			t.Fatalf("wrong gateway settlement: %+v", w)
		}
	})
}

func TestBudgetPermissionsReconciliationNoticesAndExport(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{allowPrivate: true})
		var missing atomic.Bool
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			if missing.Load() {
				answerJSON(w, `{"choices":[]}`)
				return
			}
			answerJSON(w, `{"usage":`+usageFixture+`}`)
		})
		admin := e.admin("admin@budget.test")
		teamID, modelID := stubTeam(t, admin, u, "sk-fake")
		path := "/api/teams/" + teamID
		member, memberID := e.person("member@budget.test")
		must(t, admin.post(path+"/members", map[string]string{"email": "member@budget.test"}), 201)
		outsider, _ := e.person("outsider@budget.test")
		refused(t, "outside budgets", outsider.get(path+"/budgets"), 404, "team_not_found")
		refused(t, "member budget write", member.send("PUT", path+"/budgets", budgetBody("team", "", "100", 0)), 403, "admin_required")
		must(t, admin.send("PUT", path+"/budgets", budgetBody("member", memberID, "100", 0)), 200)
		must(t, admin.send("PUT", path+"/budgets", budgetBody("member", "admin-unknown", "100", 0)), 404)
		// Unverified providers fail closed when a hard budget applies.
		refused(t, "unpriced budget", call(e.pluginFor(member), modelID, false), 403, "budget_model_unpriced")
		must(t, admin.send("PUT", path+"/model-rates/"+modelID, rateBody(0, "2")), 200)
		refused(t, "unverified upstream", call(e.pluginFor(member), modelID, false), 403, "budget_bound_unavailable")
		if u.hits() != 0 {
			t.Fatal("budget refusal contacted provider")
		}
		// Disable the cap while continuing to record usage and window counters.
		disabled := budgetBody("member", memberID, "100", 1)
		disabled["enabled"] = false
		must(t, admin.send("PUT", path+"/budgets", disabled), 200)
		missing.Store(true)
		must(t, call(e.pluginFor(member), modelID, false), 200)
		missing.Store(false)
		must(t, call(e.pluginFor(admin), modelID, false), 200)
		request := d.Client.UsageRequest.Query().Where(usagerequest.UserID(memberID)).OnlyX(ctx)
		resolution := map[string]any{"reason": "Supplier report confirmed zero consumption", "tokens": map[string]int{"input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0, "reasoning": 0}, "points": "0"}
		refused(t, "member resolution", member.post(path+"/usage/"+request.ID+"/resolve", resolution), 403, "admin_required")
		otherTeam := newTeam(t, admin, "Other")
		refused(t, "cross-team resolution", admin.post("/api/teams/"+otherTeam+"/usage/"+request.ID+"/resolve", resolution), 404, "usage_not_found")
		for _, body := range []map[string]any{{"reason": "Missing token evidence must not imply zero"}, {"reason": "Null token evidence must not imply zero", "tokens": nil}} {
			refused(t, "missing resolution evidence", admin.post(path+"/usage/"+request.ID+"/resolve", body), 400, "invalid_request")
		}
		must(t, admin.post(path+"/usage/"+request.ID+"/resolve", resolution), 204)
		refused(t, "duplicate resolution", admin.post(path+"/usage/"+request.ID+"/resolve", resolution), 409, "usage_already_resolved")
		// A member cannot inspect another member's per-person window or policy.
		must(t, admin.send("PUT", path+"/budgets", budgetBody("member", "", "100", 0)), 400)
		policy := d.Client.BudgetPolicy.Query().OnlyX(ctx)
		d.Client.BudgetPolicy.UpdateOneID(policy.ID).SetSubjectID("other-member").ExecX(ctx)
		d.Client.BudgetWindow.Update().Where(budgetwindow.TeamID(teamID)).SetSubjectID("other-member").ExecX(ctx)
		v := must(t, member.get(path+"/budgets"), 200)
		if len(v["policies"].([]any)) != 0 || len(v["windows"].([]any)) != 0 {
			t.Fatalf("member saw another personal budget: %+v", v)
		}
		// Export uses the exact same authorization filter, including forged userId.
		d.Client.UsageRequest.UpdateOneID(request.ID).SetModel(" \t=HYPERLINK(\"https://example.test\")").ExecX(ctx)
		csvResponse := member.get(path + "/usage/export?userId=someone-else")
		if csvResponse.status != 200 {
			t.Fatalf("export: %s", csvResponse.body)
		}
		records, err := csv.NewReader(strings.NewReader(string(csvResponse.body))).ReadAll()
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 2 || records[1][3] != memberID || !strings.HasPrefix(records[1][6], "' \t=") || records[1][14] != "0" {
			t.Fatalf("unsafe or unscoped export: %+v", records)
		}
		refused(t, "outside export", outsider.get(path+"/usage/export"), 404, "team_not_found")
		refused(t, "invalid export range", member.get(path+"/usage/export?since=bad"), 400, "invalid_request")
		notice := d.Client.BudgetNotice.Create().SetTeamID(teamID).SetWindowID("window").SetRecipientID(memberID).SetThreshold(80).SetState(budgetnotice.StateFailed).SetNextAt(time.Now().Add(-time.Minute)).SetData([]byte(`{}`)).SaveX(ctx)
		d.Client.BudgetNotice.Create().SetTeamID(teamID).SetWindowID("window").SetRecipientID("another-person").SetThreshold(80).SetData([]byte(`{}`)).ExecX(ctx)
		notices := member.get(path + "/budgets/notices")
		var items []map[string]any
		if err := json.Unmarshal(notices.body, &items); err != nil || len(items) != 1 || items[0]["recipientId"] != memberID {
			t.Fatalf("notice scope: %s", notices.body)
		}
		refused(t, "member retry", member.post(path+"/budgets/notices/"+notice.ID+"/retry", map[string]any{}), 403, "admin_required")
		must(t, admin.post(path+"/budgets/notices/"+notice.ID+"/retry", map[string]any{}), 204)
		refused(t, "duplicate notice retry", admin.post(path+"/budgets/notices/"+notice.ID+"/retry", map[string]any{}), 409, "notice_not_failed")
		refused(t, "cross-team notice", admin.post("/api/teams/"+otherTeam+"/budgets/notices/"+notice.ID+"/retry", map[string]any{}), 404, "notice_not_found")
	})
}
