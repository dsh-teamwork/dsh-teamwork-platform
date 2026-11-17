package usage

import (
	"context"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
)

type WindowView struct {
	ID             string  `json:"id"`
	Scope          string  `json:"scope"`
	SubjectID      string  `json:"subjectId"`
	Period         string  `json:"period"`
	StartsAt       string  `json:"startsAt"`
	EndsAt         string  `json:"endsAt"`
	Spent          string  `json:"spent"`
	Reserved       string  `json:"reserved"`
	PointLimit     *string `json:"pointLimit"`
	Remaining      *string `json:"remaining"`
	InputSpent     int64   `json:"inputSpent"`
	InputReserved  int64   `json:"inputReserved"`
	OutputSpent    int64   `json:"outputSpent"`
	OutputReserved int64   `json:"outputReserved"`
	Unpriced       int64   `json:"unpriced"`
	Unbounded      int64   `json:"unbounded"`
}

type BudgetPage struct {
	Policies []PolicyView `json:"policies"`
	Windows  []WindowView `json:"windows"`
	Summary  QuotaSummary `json:"summary"`
}

// current reads the budget policies and the open windows the caller may see:
// an admin every one, a member the team's, the providers' and their own.
func (s *Service) current(ctx context.Context, teamID, userID string, admin bool, now time.Time) ([]*ent.BudgetPolicy, []*ent.BudgetWindow, error) {
	policies := s.DB.BudgetPolicy.Query().Where(budgetpolicy.TeamID(teamID))
	if !admin {
		policies.Where(budgetpolicy.Or(budgetpolicy.ScopeNEQ(budgetpolicy.ScopeMember), budgetpolicy.SubjectID(userID)))
	}
	rows, err := policies.Order(ent.Asc(budgetpolicy.FieldScope), ent.Asc(budgetpolicy.FieldSubjectID), ent.Asc(budgetpolicy.FieldPeriod)).All(ctx)
	if err != nil {
		return nil, nil, err
	}
	if !admin {
		rows = selectPolicies(rows)
	}
	q := s.DB.BudgetWindow.Query().Where(budgetwindow.TeamID(teamID), budgetwindow.StartsAtLTE(now), budgetwindow.EndsAtGT(now))
	if !admin {
		q.Where(budgetwindow.Or(budgetwindow.ScopeNEQ(budgetwindow.ScopeMember), budgetwindow.SubjectID(userID)))
	}
	windows, err := q.Order(ent.Asc(budgetwindow.FieldScope), ent.Asc(budgetwindow.FieldSubjectID)).All(ctx)
	return rows, windows, err
}

func (s *Service) Budgets(ctx context.Context, teamID, userID string, admin bool) (BudgetPage, error) {
	now := s.now()
	rows, windows, err := s.current(ctx, teamID, userID, admin, now)
	if err != nil {
		return BudgetPage{}, err
	}
	p := BudgetPage{Policies: []PolicyView{}, Windows: []WindowView{}}
	for _, row := range rows {
		p.Policies = append(p.Policies, policyView(row, now))
	}
	for _, w := range windows {
		p.Windows = append(p.Windows, windowView(rows, w))
	}
	p.Summary, err = summarizeQuota(rows, p.Windows, userID, now)
	return p, err
}

func windowView(rows []*ent.BudgetPolicy, w *ent.BudgetWindow) WindowView {
	v := WindowView{ID: w.ID, Scope: string(w.Scope), SubjectID: w.SubjectID, Period: string(w.Period),
		StartsAt: w.StartsAt.UTC().Format(time.RFC3339Nano), EndsAt: w.EndsAt.UTC().Format(time.RFC3339Nano),
		Spent: FormatPoints(w.SpentUnits), Reserved: FormatPoints(w.ReservedUnits), InputSpent: w.SpentInput, InputReserved: w.ReservedInput,
		OutputSpent: w.SpentOutput, OutputReserved: w.ReservedOutput, Unpriced: w.UnpricedCount, Unbounded: w.UnboundedCount}
	policy := windowPolicy(rows, w)
	if policy != nil && policy.Enabled && policy.PointLimit != nil {
		v.PointLimit = new(FormatPoints(*policy.PointLimit))
		if w.UnpricedCount == 0 && w.UnboundedCount == 0 {
			// Subtract in order to avoid overflow even above a lowered cap.
			available := max(0, *policy.PointLimit-w.SpentUnits)
			v.Remaining = new(FormatPoints(max(0, available-w.ReservedUnits)))
		}
	}
	return v
}
