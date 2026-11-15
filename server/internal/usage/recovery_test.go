package usage

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetevent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestResolutionKeepsEvidenceAndRebuildableCounters(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := &Service{DB: d.Client}
		call := referenceCall("member", 100, 100)
		setTestRate(t, s, call)
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("team", "", "0.2")); err != nil {
			t.Fatal(err)
		}
		r, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Finish(ctx, r, Observation{}, "client_disconnected"); err != nil {
			t.Fatal(err)
		}
		in := ResolutionInput{Reason: "Supplier confirmed no generation for this request", Tokens: Tokens{}}
		if err := s.Resolve(ctx, "team", "admin", r.ID, in); err != nil {
			t.Fatal(err)
		}
		wantCode(t, s.Resolve(ctx, "team", "admin", r.ID, in), "usage_already_resolved")
		resolved := d.Client.UsageRequest.GetX(ctx, r.ID)
		if resolved.State != "estimated" || resolved.PointUnits == nil || *resolved.PointUnits != 0 {
			t.Fatalf("resolution: %+v", resolved)
		}
		before := d.Client.BudgetEvent.Query().Where(budgetevent.ActionKey("resolution:" + r.ID)).OnlyX(ctx)
		var evidence struct{ Before struct{ State string } }
		if json.Unmarshal(before.Data, &evidence) != nil || evidence.Before.State != "pending" {
			t.Fatal("prior evidence was not preserved")
		}
		if err := s.Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 10}}, ""); err != nil {
			t.Fatal(err)
		}
		if d.Client.BudgetEvent.Query().Where(budgetevent.KindEQ("late_usage")).CountX(ctx) != 1 {
			t.Fatal("late actual evidence lost")
		}
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if w.ReservedUnits != 0 || w.SpentUnits != 0 {
			t.Fatalf("late report silently changed resolution: %+v", w)
		}
		var sum CounterDelta
		for _, event := range d.Client.BudgetEvent.Query().Where(budgetevent.WindowID(w.ID)).AllX(ctx) {
			var delta CounterDelta
			if err := json.Unmarshal(event.Data, &delta); err != nil {
				t.Fatal(err)
			}
			sum.SpentUnits += delta.SpentUnits
			sum.ReservedUnits += delta.ReservedUnits
			sum.SpentInput += delta.SpentInput
			sum.ReservedInput += delta.ReservedInput
			sum.SpentOutput += delta.SpentOutput
			sum.ReservedOutput += delta.ReservedOutput
			sum.Unpriced += delta.Unpriced
			sum.Unbounded += delta.Unbounded
		}
		if sum.SpentUnits != w.SpentUnits || sum.ReservedUnits != w.ReservedUnits || sum.SpentInput != w.SpentInput || sum.ReservedInput != w.ReservedInput || sum.Unpriced != w.UnpricedCount || sum.Unbounded != w.UnboundedCount {
			t.Fatalf("counter rebuild mismatch: %+v %+v", sum, w)
		}
		if _, err := s.Begin(ctx, call); err != nil {
			t.Fatalf("manual release did not restore availability: %v", err)
		}
	})
}

func TestWindowTransitionAndLostRequestDoNotReleaseOldHolds(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		now := time.Date(2026, 11, 30, 23, 30, 0, 0, time.UTC)
		s := &Service{DB: d.Client, Now: func() time.Time { return now }}
		call := referenceCall("member", 100, 100)
		setTestRate(t, s, call)
		policy := testPolicy("team", "", "0.2")
		if _, err := s.SetPolicy(ctx, "team", "admin", policy); err != nil {
			t.Fatal(err)
		}
		old, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		policy.Revision, policy.Timezone = 1, "Asia/Shanghai"
		more := "0.3"
		policy.Points = &more
		if _, err := s.SetPolicy(ctx, "team", "admin", policy); err != nil {
			t.Fatal(err)
		}
		_, err = s.Begin(ctx, call)
		wantCode(t, err, "budget_exhausted")
		now = time.Date(2026, 12, 1, 0, 10, 0, 0, time.UTC)
		if err := s.MarkLost(ctx); err != nil {
			t.Fatal(err)
		}
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if w.ReservedUnits != 200_000_000 || d.Client.UsageRequest.GetX(ctx, old.ID).State != "pending" {
			t.Fatal("expired process erased a hold")
		}
		if _, err := s.Begin(ctx, call); err != nil {
			t.Fatalf("new month admission: %v", err)
		}
		if err := s.Finish(ctx, old, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 10, Output: 5}}, ""); err != nil {
			t.Fatal(err)
		}
		oldWindow := d.Client.BudgetWindow.GetX(ctx, w.ID)
		if oldWindow.SpentUnits != 15_000_000 || oldWindow.ReservedUnits != 0 {
			t.Fatalf("late settlement went to wrong month: %+v", oldWindow)
		}
		newWindow := d.Client.BudgetWindow.Query().Where(budgetwindow.IDNEQ(w.ID)).OnlyX(ctx)
		boundary := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
		if !newWindow.StartsAt.Equal(boundary) || newWindow.SpentUnits != 0 || newWindow.ReservedUnits != 200_000_000 {
			t.Fatalf("timezone transition reset/overlapped spend: %+v", newWindow)
		}
	})
}

func TestUnexpectedBoundOverrunSuspendsTheProviderRoute(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := &Service{DB: d.Client}
		call := referenceCall("member", 100, 100)
		setTestRate(t, s, call)
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("team", "", "1")); err != nil {
			t.Fatal(err)
		}
		r, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 201}}, ""); err != nil {
			t.Fatal(err)
		}
		_, err = s.Begin(ctx, call)
		wantCode(t, err, "budget_route_suspended")
		if err := s.Resolve(ctx, "team", "admin", r.ID, ResolutionInput{Reason: "Supplier route reviewed and its bound corrected"}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Begin(ctx, call); err != nil {
			t.Fatalf("review did not restore route: %v", err)
		}
	})
}
