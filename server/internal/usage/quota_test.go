package usage

import (
	"context"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestQuotaSummaryIsOwnEffectiveAllowanceEvenForAdministrators(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := &Service{DB: d.Client}
		call := referenceCall("member", 100, 100)
		setTestRate(t, s, call)
		for _, p := range []PolicyInput{testPolicy("team", "", "30"), testPolicy("default_member", "", "10"), testPolicy("member", "other", "0"), testPolicy("provider", call.Provider, "0")} {
			if _, err := s.SetPolicy(ctx, "team", "admin", p); err != nil {
				t.Fatal(err)
			}
		}
		page, err := s.Budgets(ctx, "team", "member", true)
		if err != nil || page.Summary.Remaining == nil || *page.Summary.Remaining != "10" || page.Summary.Exhausted {
			t.Fatalf("other member/provider affected own summary %+v %v", page.Summary, err)
		}
		if n := d.Client.BudgetWindow.Query().CountX(ctx); n != 0 {
			t.Fatal("read created budget windows")
		}
		// Disable only the provider constraint for a real admission.
		p := testPolicy("provider", call.Provider, "0")
		p.Revision = 1
		p.Enabled = false
		if _, err := s.SetPolicy(ctx, "team", "admin", p); err != nil {
			t.Fatal(err)
		}
		r, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		page, err = s.Budgets(ctx, "team", "member", true)
		if err != nil || page.Summary.Remaining == nil || *page.Summary.Remaining != "9.8" {
			t.Fatalf("hold not deducted %+v %v", page.Summary, err)
		}
		if err := s.Finish(ctx, r, Observation{Known: true, Complete: true, Tokens: Tokens{Input: 100, Output: 50}}, ""); err != nil {
			t.Fatal(err)
		}
		page, err = s.Budgets(ctx, "team", "member", false)
		if err != nil || page.Summary.Remaining == nil || *page.Summary.Remaining != "9.85" {
			t.Fatalf("settlement not reflected %+v %v", page.Summary, err)
		}
		override := testPolicy("member", "member", "0")
		if _, err := s.SetPolicy(ctx, "team", "admin", override); err != nil {
			t.Fatal(err)
		}
		page, err = s.Budgets(ctx, "team", "member", true)
		if err != nil || !page.Summary.Exhausted || page.Summary.Remaining == nil || *page.Summary.Remaining != "0" {
			t.Fatalf("lowered own override %+v %v", page.Summary, err)
		}
	})
}

func TestQuotaSummaryHoldsPendingUsageAndTokenOnlyExhaustion(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		now := time.Now().UTC().Truncate(time.Second)
		s := &Service{DB: d.Client, Now: func() time.Time { return now }}
		total := int64(200)
		p := PolicyInput{Scope: "default_member", Period: "day", Timezone: "America/Denver", Enabled: true, Total: &total}
		if _, err := s.SetPolicy(ctx, "team", "admin", p); err != nil {
			t.Fatal(err)
		}
		call := referenceCall("member", 100, 100)
		setTestRate(t, s, call)
		running, err := s.Begin(ctx, call)
		if err != nil {
			t.Fatal(err)
		}
		page, err := s.Budgets(ctx, "team", "member", false)
		if err != nil || !page.Summary.Exhausted || !page.Summary.TokenLimited || page.Summary.Remaining != nil {
			t.Fatalf("token-only summary %+v %v", page.Summary, err)
		}
		points := "10"
		p.Points = &points
		p.Revision = 1
		if _, err := s.SetPolicy(ctx, "team", "admin", p); err != nil {
			t.Fatal(err)
		}
		// A response cut off before its usage: the call stays pending, and its hold, priced at admission, stays
		// counted against the cap rather than being forgotten or made up.
		if err := s.Finish(ctx, running, Observation{}, ""); err != nil {
			t.Fatal(err)
		}
		page, err = s.Budgets(ctx, "team", "member", false)
		if err != nil || page.Summary.State != "known" || page.Summary.Remaining == nil || *page.Summary.Remaining != "9.8" || page.Windows[0].Reserved != "0.2" {
			t.Fatalf("a pending call's hold %+v %+v %v", page.Summary, page.Windows, err)
		}
		if page.Summary.ResetAt == nil || *page.Summary.ResetAt != page.Windows[0].EndsAt {
			t.Fatal("active IANA window boundary changed")
		}
	})
}
