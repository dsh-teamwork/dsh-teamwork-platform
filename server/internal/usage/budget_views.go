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

func (s *Service) Budgets(ctx context.Context, teamID, userID string, admin bool) (BudgetPage, error) {
	now := s.now()
	policies := s.DB.BudgetPolicy.Query().Where(budgetpolicy.TeamID(teamID))
	if !admin {
		policies.Where(budgetpolicy.Or(budgetpolicy.ScopeNEQ(budgetpolicy.ScopeMember), budgetpolicy.SubjectID(userID)))
	}
	rows, err := policies.Order(ent.Asc(budgetpolicy.FieldScope), ent.Asc(budgetpolicy.FieldSubjectID), ent.Asc(budgetpolicy.FieldPeriod)).All(ctx)
	if err != nil {
		return BudgetPage{}, err
	}
	if !admin {
		rows = selectPolicies(rows)
	}
	p := BudgetPage{Policies: []PolicyView{}, Windows: []WindowView{}}
	for _, row := range rows {
		p.Policies = append(p.Policies, policyView(row, now))
	}
	q := s.DB.BudgetWindow.Query().Where(budgetwindow.TeamID(teamID), budgetwindow.StartsAtLTE(now), budgetwindow.EndsAtGT(now))
	if !admin {
		q.Where(budgetwindow.Or(budgetwindow.ScopeNEQ(budgetwindow.ScopeMember), budgetwindow.SubjectID(userID)))
	}
	windows, err := q.Order(ent.Asc(budgetwindow.FieldScope), ent.Asc(budgetwindow.FieldSubjectID)).All(ctx)
	if err != nil {
		return BudgetPage{}, err
	}
	for _, w := range windows {
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
		p.Windows = append(p.Windows, v)
	}
	p.Summary, err = summarizeQuota(rows, p.Windows, userID, now)
	return p, err
}
