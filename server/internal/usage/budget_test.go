package usage

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func TestMemberInheritanceUnpricedTokensAndClockRegression(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		now := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
		s := &Service{DB: d.Client, Now: func() time.Time { return now }}
		call := referenceCall("member", 100, 100)
		total := int64(400)
		policy := PolicyInput{Scope: "default_member", Period: "day", Timezone: "UTC", Enabled: true, Total: &total}
		if _, err := s.SetPolicy(ctx, "team", "admin", policy); err != nil {
			t.Fatal(err)
		}
		first, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		second, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.Begin(ctx, call)
		wantCode(t, err, "budget_exhausted")
		// Missing monetary reference rates do not serialize a token-only budget.
		for _, r := range []*ent.UsageRequest{first, second} {
			if err := s.Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 100, Output: 50}}, ""); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.Resolve(ctx, "team", "admin", first.ID, ResolutionInput{Reason: "Supplier usage report confirmed these token counts", Tokens: Tokens{Input: 100, Output: 50}, Points: new("0.15")}); err != nil {
			t.Fatal(err)
		}
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if w.UnpricedCount != 1 || w.SpentUnits != 150000000 || w.SpentInput != 200 || w.SpentOutput != 100 {
			t.Fatalf("unpriced resolution changed token usage: %+v", w)
		}
		// Temporarily removing a member override does not create a fresh allowance.
		override := PolicyInput{Scope: "member", SubjectID: "member", Period: "day", Timezone: "UTC", Enabled: false, Points: new("0")}
		p, err := s.SetPolicy(ctx, "team", "admin", override)
		if err != nil {
			t.Fatal(err)
		}
		r, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 60, Output: 40}}, ""); err != nil {
			t.Fatal(err)
		}
		override.Points = nil
		override.Revision = p.Revision
		if _, err := s.SetPolicy(ctx, "team", "admin", override); err != nil {
			t.Fatal(err)
		}
		_, err = s.Begin(ctx, call)
		wantCode(t, err, "budget_exhausted")
		if d.Client.BudgetWindow.Query().CountX(ctx) != 1 {
			t.Fatal("inheritance reset the window")
		}
		now = now.Add(-time.Minute)
		if _, err := s.Begin(ctx, call); err == nil {
			t.Fatal("clock regression accepted")
		}
	})
}

func TestExportRejectsOversizeBeforeReturningPartialRows(t *testing.T) {
	d := testdb.New(t, "sqlite")
	ctx := context.Background()
	for i := 0; i < 10001; i += 200 {
		batch := make([]*ent.UsageRequestCreate, 0, 200)
		for j := i; j < min(i+200, 10001); j++ {
			batch = append(batch, d.Client.UsageRequest.Create().SetTeamID("team").SetUserID("member").SetSubmittedConfigID("model").SetConfigID("model").SetProvider("test").SetModel("test").SetStream(false))
		}
		if err := d.Client.UsageRequest.CreateBulk(batch...).Exec(ctx); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := (&Service{DB: d.Client}).Export(ctx, Filter{TeamID: "team"})
	wantCode(t, err, "usage_export_too_large")
	if rows != nil {
		t.Fatal("oversize export returned a partial result")
	}
}

func referenceCall(user string, input, output int64) Call {
	return Call{TeamID: "team", UserID: user, ConfigID: "model", SubmittedConfigID: "model", Provider: "provider", Model: "test-model",
		Bounds: func() (Tokens, error) { return Tokens{Input: input, Output: output}, nil }}
}

func setTestRate(t *testing.T, s *Service, call Call) {
	t.Helper()
	if _, err := s.SetRate(context.Background(), call, RateInput{Basis: "cost", Input: "1", CacheRead: "1", CacheWrite: "0", Output: "1"}); err != nil {
		t.Fatal(err)
	}
}

func testPolicy(scope, subject, points string) PolicyInput {
	return PolicyInput{Scope: scope, SubjectID: subject, Period: "month", Timezone: "UTC", Enabled: true, Points: &points}
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var refusal *wire.Error
	if !errors.As(err, &refusal) || refusal.Code != code {
		t.Fatalf("error = %v, want %s", err, code)
	}
}

func TestConcurrentAdmissionsAcrossDatabaseClients(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		other, _, err := db.Open(ctx, d.Target)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { other.Close() })
		services := []*Service{{DB: d.Client}, {DB: other}}
		call := referenceCall("member", 100, 100)
		setTestRate(t, services[0], call)
		if _, err := services[0].SetPolicy(ctx, "team", "admin", testPolicy("team", "", "0.4")); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		accepted := make(chan string, 20)
		failures := make(chan error, 20)
		for i := range 20 {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				r, err := services[i%2].Begin(ctx, call)
				if err != nil {
					failures <- err
					return
				}
				accepted <- r.ID
			}(i)
		}
		wg.Wait()
		close(accepted)
		close(failures)
		if len(accepted) != 2 {
			t.Fatalf("%d admissions, want 2", len(accepted))
		}
		page, err := services[0].Budgets(ctx, "team", "member", true)
		if err != nil || len(page.Windows) != 1 || page.Windows[0].Remaining == nil || *page.Windows[0].Remaining != "0" {
			t.Fatalf("availability ignored concurrent holds: %+v %v", page, err)
		}
		for err := range failures {
			wantCode(t, err, "budget_exhausted")
		}
		for id := range accepted {
			r := d.Client.UsageRequest.GetX(ctx, id)
			for range 2 {
				if err := services[0].Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 10, Output: 5}}, ""); err != nil {
					t.Fatal(err)
				}
			}
		}
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if w.SpentUnits != 30_000_000 || w.ReservedUnits != 0 || w.SpentInput != 20 || w.SpentOutput != 10 {
			t.Fatalf("incorrect release or double settlement: %+v", w)
		}
		page, err = services[0].Budgets(ctx, "team", "member", true)
		if err != nil || page.Windows[0].Remaining == nil || *page.Windows[0].Remaining != "0.37" {
			t.Fatalf("availability did not release unused holds: %+v %v", page, err)
		}
		if _, err := services[1].Begin(ctx, call); err != nil {
			t.Fatalf("unused reservation was not released: %v", err)
		}
	})
}

func TestMemberOverrideContinuesDefaultSpendAndMultiScopeRollback(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := &Service{DB: d.Client}
		call := referenceCall("member", 10, 10)
		setTestRate(t, s, call)
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("default_member", "", "0.04")); err != nil {
			t.Fatal(err)
		}
		r, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 10, Output: 5}}, ""); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("member", "member", "0.02")); err != nil {
			t.Fatal(err)
		}
		_, err = s.Begin(ctx, call)
		wantCode(t, err, "budget_exhausted")
		if d.Client.BudgetWindow.Query().CountX(ctx) != 1 {
			t.Fatal("override opened a second allowance")
		}
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("team", "", "1")); err != nil {
			t.Fatal(err)
		}
		_, err = s.Begin(ctx, call)
		wantCode(t, err, "budget_exhausted")
		if d.Client.BudgetWindow.Query().Where(budgetwindow.ScopeEQ(budgetwindow.ScopeTeam)).CountX(ctx) != 0 {
			t.Fatal("failed member admission left a team window/hold")
		}
		if d.Client.UsageRequest.Query().CountX(ctx) != 1 {
			t.Fatal("rejected requests were dispatched or retained as active calls")
		}
	})
}

func TestPendingUsageKeepsReservationAcrossRestart(t *testing.T) {
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
		other, _, err := db.Open(ctx, d.Target)
		if err != nil {
			t.Fatal(err)
		}
		defer other.Close()
		_, err = (&Service{DB: other}).Begin(ctx, call)
		wantCode(t, err, "budget_exhausted")
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if w.ReservedUnits != 200_000_000 || w.SpentUnits != 0 {
			t.Fatalf("pending hold erased: %+v", w)
		}
	})
}

func TestCalendarWindowsIncludeDST(t *testing.T) {
	for _, tc := range []struct {
		at    time.Time
		hours time.Duration
	}{
		{time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), 23},
		{time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC), 25},
	} {
		start, end, err := calendarWindow(tc.at, "America/Denver", "day")
		if err != nil || end.Sub(start) != tc.hours*time.Hour {
			t.Fatalf("DST window: %v %v %v", start, end, err)
		}
	}
}
