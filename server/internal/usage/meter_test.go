package usage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// meterFunding stands in for an edition's wallet: it records what the public
// transaction hands it, and can refuse to show that a refusal rolls back.
type meterFunding struct {
	reserved, settled []string
	units             []int64
	refuse            bool
}

func (f *meterFunding) ReserveMeter(_ context.Context, _ edition.SQLExecutor, in edition.MeterAdmission) error {
	if f.refuse {
		return errors.New("wallet refused")
	}
	f.reserved = append(f.reserved, in.RequestID)
	return nil
}

func (f *meterFunding) SettleMeter(_ context.Context, _ edition.SQLExecutor, out edition.MeterSettlement) error {
	f.settled = append(f.settled, out.RequestID)
	f.units = append(f.units, out.Units)
	return nil
}

var vm = edition.Meter{Name: "cloud.vm.small", Unit: "second",
	Labels: map[string]string{"en": "Cloud computer", "zh-CN": "Cloud computer (zh)"}, UnitLabels: map[string]string{"en": "s", "zh-CN": "s (zh)"}}

const point = int64(1_000_000_000)

func TestMeterRegistrationIsValidatedAndOwnedOnce(t *testing.T) {
	s := &Service{}
	f := &meterFunding{}
	bad := []edition.Meter{
		{Name: "Cloud VM", Unit: "second", Labels: vm.Labels, UnitLabels: vm.UnitLabels},
		{Name: "cloud.vm", Unit: "", Labels: vm.Labels, UnitLabels: vm.UnitLabels},
		{Name: "cloud.vm", Unit: "second", Labels: map[string]string{"en": "Only English"}, UnitLabels: vm.UnitLabels},
	}
	for _, m := range bad {
		if _, err := s.RegisterMeters("cloud", []edition.Meter{m}, f); err == nil {
			t.Fatalf("accepted invalid meter %+v", m)
		}
	}
	if _, err := s.RegisterMeters("cloud", []edition.Meter{vm}, nil); err == nil {
		t.Fatal("accepted a meter without funding")
	}
	if _, err := s.RegisterMeters("cloud", []edition.Meter{vm}, f); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RegisterMeters("cloud", []edition.Meter{{Name: "cloud.other", Unit: "second", Labels: vm.Labels, UnitLabels: vm.UnitLabels}}, f); err == nil {
		t.Fatal("an extension registered twice")
	}
	if _, err := s.RegisterMeters("other", []edition.Meter{vm}, f); err == nil {
		t.Fatal("two extensions share a meter name")
	}
}

func TestMeteredUsageSharesTheMemberBudgetAndSettlesWithItsFunding(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
		s := &Service{DB: d.Client, Now: func() time.Time { return now }}
		f := &meterFunding{}
		host, err := s.RegisterMeters("cloud", []edition.Meter{vm}, f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("member", "member", "10")); err != nil {
			t.Fatal(err)
		}
		// A provider's budget never limits a meter, which belongs to no provider.
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("provider", "provider", "0")); err != nil {
			t.Fatal(err)
		}
		use := edition.MeterUse{TeamID: "team", UserID: "member", Meter: vm.Name, Points: 6 * point, For: 10 * time.Minute}
		first, err := host.Reserve(ctx, use)
		if err != nil {
			t.Fatal(err)
		}
		_, err = host.Reserve(ctx, use)
		wantCode(t, err, "budget_exhausted")

		// The measured time spends less than was held, and frees the rest.
		if err := host.Settle(ctx, first, 600, 4*point); err != nil {
			t.Fatal(err)
		}
		w := d.Client.BudgetWindow.Query().Where(budgetwindow.SubjectID("member")).OnlyX(ctx)
		if w.SpentUnits != 4*point || w.ReservedUnits != 0 || w.SpentInput != 0 || w.SpentOutput != 0 {
			t.Fatalf("window after settlement: %+v", w)
		}
		second, err := host.Reserve(ctx, use)
		if err != nil {
			t.Fatalf("the freed hold was not available again: %v", err)
		}
		if len(f.reserved) != 2 || f.settled[0] != first || f.units[0] != 4*point {
			t.Fatalf("funding saw %+v", f)
		}
		// Settling twice changes nothing.
		if err := host.Settle(ctx, first, 900, 9*point); err != nil {
			t.Fatal(err)
		}
		row := d.Client.UsageRequest.GetX(ctx, first)
		if row.State != usagerequest.StateSettled || *row.PointUnits != 4*point || *row.Quantity != 600 || len(f.settled) != 1 {
			t.Fatalf("a second settlement changed the row: %+v", row)
		}

		// A member's usage shows what was measured, in the meter's own words.
		page, err := s.List(ctx, Filter{TeamID: "team", Page: 1, Size: 10})
		if err != nil {
			t.Fatal(err)
		}
		var shown *MeterView
		for _, e := range page.Entries {
			if e.ID == first {
				shown = e.Meter
			}
		}
		if shown == nil || shown.Name != vm.Name || shown.Unit != "second" || *shown.Quantity != 600 || shown.Labels["zh-CN"] != vm.Labels["zh-CN"] {
			t.Fatalf("listed meter %+v", shown)
		}

		// Another extension cannot settle it, and an administrator cannot estimate it.
		other, err := s.RegisterMeters("other", []edition.Meter{{Name: "other.thing", Unit: "second", Labels: vm.Labels, UnitLabels: vm.UnitLabels}}, &meterFunding{})
		if err != nil {
			t.Fatal(err)
		}
		if err := other.Settle(ctx, second, 1, 1); err == nil {
			t.Fatal("another extension settled the meter")
		}
		err = s.Resolve(ctx, "team", "admin", second, ResolutionInput{Reason: "Trying to estimate a metered entry", Tokens: Tokens{}})
		wantCode(t, err, "usage_meter_owned")
	})
}

func TestARefusedMeterHoldRollsBackAndALostOneStaysHeldUntilSettled(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
		s := &Service{DB: d.Client, Now: func() time.Time { return now }}
		f := &meterFunding{refuse: true}
		host, err := s.RegisterMeters("cloud", []edition.Meter{vm}, f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetPolicy(ctx, "team", "admin", testPolicy("team", "", "100")); err != nil {
			t.Fatal(err)
		}
		use := edition.MeterUse{TeamID: "team", UserID: "member", Meter: vm.Name, Points: 5 * point, For: time.Minute}
		if _, err := host.Reserve(ctx, use); err == nil {
			t.Fatal("a refused wallet still admitted the hold")
		}
		if n := d.Client.UsageRequest.Query().CountX(ctx); n != 0 {
			t.Fatalf("a refused hold left %d usage rows", n)
		}
		if w, err := d.Client.BudgetWindow.Query().Only(ctx); err == nil && w.ReservedUnits != 0 {
			t.Fatalf("a refused hold left points reserved: %+v", w)
		}

		f.refuse = false
		id, err := host.Reserve(ctx, use)
		if err != nil {
			t.Fatal(err)
		}
		// The dispatcher never reports back: the hold is marked lost, not released.
		now = now.Add(2 * time.Minute)
		if err := s.MarkLost(ctx); err != nil {
			t.Fatal(err)
		}
		lost := d.Client.UsageRequest.GetX(ctx, id)
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if lost.State != usagerequest.StatePending || w.ReservedUnits != 5*point {
			t.Fatalf("lost hold: %s, window %+v", lost.State, w)
		}
		// Settling later still spends it; more than was held is flagged.
		if err := host.Settle(ctx, id, 120, 6*point); err != nil {
			t.Fatal(err)
		}
		settled := d.Client.UsageRequest.GetX(ctx, id)
		w = d.Client.BudgetWindow.Query().OnlyX(ctx)
		if settled.State != usagerequest.StateSettled || settled.ErrorCode != "usage_bound_exceeded" || w.ReservedUnits != 0 || w.SpentUnits != 6*point {
			t.Fatalf("settled lost hold: %+v, window %+v", settled, w)
		}
	})
}
