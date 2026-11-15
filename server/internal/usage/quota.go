package usage

import (
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
)

// QuotaSummary is advisory availability for the authenticated member, including
// admins. Provider-specific limits remain on the detail page: exhausting one
// provider must not label every model in the team as exhausted.
type QuotaSummary struct {
	Remaining    *string `json:"remaining"`
	State        string  `json:"state"`
	ResetAt      *string `json:"resetAt"`
	TokenLimited bool    `json:"tokenLimited"`
	Exhausted    bool    `json:"exhausted"`
}

func summarizeQuota(rows []*ent.BudgetPolicy, windows []WindowView, userID string, now time.Time) (QuotaSummary, error) {
	q := QuotaSummary{State: "unlimited"}
	selected := make([]*ent.BudgetPolicy, 0, len(rows))
	for _, p := range rows {
		if p.Scope == budgetpolicy.ScopeTeam || p.Scope == budgetpolicy.ScopeDefaultMember || p.Scope == budgetpolicy.ScopeMember && p.SubjectID == userID {
			selected = append(selected, p)
		}
	}
	selected = selectPolicies(selected)
	var minimum *int64
	for _, p := range selected {
		if !p.Enabled {
			continue
		}
		scope, subject := string(p.Scope), p.SubjectID
		if scope == "default_member" {
			scope, subject = "member", userID
		}
		_, end, err := calendarWindow(now, policyView(p, now).ActiveTimezone, string(p.Period))
		if err != nil {
			return q, err
		}
		w := WindowView{}
		for _, candidate := range windows {
			if candidate.Scope == scope && candidate.SubjectID == subject && candidate.Period == string(p.Period) {
				w = candidate
				end, err = time.Parse(time.RFC3339Nano, w.EndsAt)
				if err != nil {
					return q, err
				}
				break
			}
		}
		reset := end.UTC().Format(time.RFC3339Nano)
		if q.ResetAt == nil || resetBefore(end, *q.ResetAt) {
			q.ResetAt = &reset
		}
		if p.PointLimit != nil {
			if w.Unpriced > 0 || w.Unbounded > 0 {
				q.State = "unconfirmed"
			} else {
				spent, err := Decimal(w.Spent, 9)
				if w.Spent == "" {
					spent, err = 0, nil
				}
				if err != nil {
					return q, err
				}
				held, err := Decimal(w.Reserved, 9)
				if w.Reserved == "" {
					held, err = 0, nil
				}
				if err != nil {
					return q, err
				}
				n := max(0, max(0, *p.PointLimit-spent)-held)
				if minimum == nil || n < *minimum {
					minimum = new(n)
				}
				if n == 0 {
					q.Exhausted = true
				}
			}
		}
		for _, cap := range []struct {
			limit                              *int64
			spent, held, extraSpent, extraHeld int64
		}{
			{p.InputLimit, w.InputSpent, w.InputReserved, 0, 0},
			{p.OutputLimit, w.OutputSpent, w.OutputReserved, 0, 0},
			{p.TotalLimit, w.InputSpent, w.InputReserved, w.OutputSpent, w.OutputReserved},
		} {
			if cap.limit == nil {
				continue
			}
			q.TokenLimited = true
			if w.Unbounded > 0 {
				q.State = "unconfirmed"
				continue
			}
			left := *cap.limit
			for _, n := range []int64{cap.spent, cap.held, cap.extraSpent, cap.extraHeld} {
				left = max(0, left-n)
			}
			if left == 0 {
				q.Exhausted = true
			}
		}
	}
	if q.State != "unconfirmed" && minimum != nil {
		q.State = "known"
		q.Remaining = new(FormatPoints(*minimum))
	}
	return q, nil
}

func resetBefore(at time.Time, raw string) bool {
	other, err := time.Parse(time.RFC3339Nano, raw)
	return err == nil && at.Before(other)
}
