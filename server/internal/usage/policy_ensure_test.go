package usage

import (
	"context"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestEnsurePolicyIsIdempotent(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := &Service{DB: d.Client}
		points := "100"
		in := PolicyInput{Scope: "default_member", Period: "day", Timezone: "Asia/Shanghai", Enabled: true, Notify: "none", Points: &points}
		if err := s.EnsurePolicy(ctx, "team", "system", in); err != nil {
			t.Fatal(err)
		}
		p, err := d.Client.BudgetPolicy.Query().Where(budgetpolicy.TeamID("team")).Only(ctx)
		if err != nil || p.Revision != 1 {
			t.Fatalf("initial policy: %#v, %v", p, err)
		}
		points = "100.000000000"
		if err := s.EnsurePolicy(ctx, "team", "system", in); err != nil {
			t.Fatal(err)
		}
		p, _ = d.Client.BudgetPolicy.Get(ctx, p.ID)
		if p.Revision != 1 {
			t.Fatalf("identical policy revised to %d", p.Revision)
		}
		if n, _ := d.Client.BudgetEvent.Query().Count(ctx); n != 1 {
			t.Fatalf("identical policy wrote an event: %d", n)
		}
		points = "200"
		if err := s.EnsurePolicy(ctx, "team", "system", in); err != nil {
			t.Fatal(err)
		}
		p, _ = d.Client.BudgetPolicy.Get(ctx, p.ID)
		if p.Revision != 2 || p.PointLimit == nil || FormatPoints(*p.PointLimit) != "200" {
			t.Fatalf("changed policy: %#v", p)
		}
	})
}
