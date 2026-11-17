package usage

import (
	"context"
	"database/sql"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
)

// SummaryPeriod is how far back a summary counts calls: the usage page's
// default range, so the two agree on what "recent" means.
const SummaryPeriod = 30 * 24 * time.Hour

// Summary is what a team's overview shows about usage and budgets, scoped to
// the caller: an admin sees the team, a member their own calls and the
// limits that apply to them. The counts are of what waits on somebody;
// details stay on the usage and budget pages.
type Summary struct {
	Since string `json:"since"`
	// Model calls in the period.
	Calls int `json:"calls"`
	// Points spent in the period: priced model calls and edition meters.
	Points string `json:"points"`
	// Unpriced calls in the period: Points leaves them out, so it can undercount.
	Unpriced int `json:"unpriced"`
	// Calls an admin has to resolve before they count (always 0 for a member).
	Unresolved int `json:"unresolved"`
	// Budget mail that could not be delivered (always 0 for a member).
	FailedNotices int          `json:"failedNotices"`
	NearLimit     []LimitView  `json:"nearLimit"`
	Budget        QuotaSummary `json:"budget"`
}

// LimitView is an open budget window at or past a notice threshold.
type LimitView struct {
	Scope     string `json:"scope"`
	SubjectID string `json:"subjectId"`
	Period    string `json:"period"`
	Threshold int    `json:"threshold"`
}

func (s *Service) Summary(ctx context.Context, teamID, userID string, admin bool) (Summary, error) {
	now := s.now()
	f := Filter{TeamID: teamID, Since: now.Add(-SummaryPeriod)}
	if !admin {
		f.UserID = userID
	}
	out := Summary{Since: f.Since.Format(time.RFC3339Nano), NearLimit: []LimitView{}}
	var err error
	// Calls, unpriced and unresolved count model calls only: an edition's metered
	// row (ADR 0036) is no call, and only its edition settles it. Points count
	// everything the period spent, meters included.
	calls := func(q *ent.UsageRequestQuery) *ent.UsageRequestQuery { return q.Where(usagerequest.Meter("")) }
	if out.Calls, err = calls(s.query(f)).Count(ctx); err != nil {
		return out, err
	}
	var sum []struct {
		Sum sql.NullInt64 `json:"sum"`
	}
	if err = s.query(f).Aggregate(ent.Sum(usagerequest.FieldPointUnits)).Scan(ctx, &sum); err != nil {
		return out, err
	}
	var units int64
	if len(sum) == 1 && sum[0].Sum.Valid {
		units = sum[0].Sum.Int64
	}
	out.Points = FormatPoints(units)
	if out.Unpriced, err = calls(s.query(f)).Where(usagerequest.StateIn(usagerequest.StateUnpriced, usagerequest.StatePending)).Count(ctx); err != nil {
		return out, err
	}
	if admin {
		// The same calls the usage page offers to resolve, whenever they were made.
		out.Unresolved, err = calls(s.query(Filter{TeamID: teamID})).Where(usagerequest.Or(
			usagerequest.StateIn(usagerequest.StateUnpriced, usagerequest.StatePending),
			usagerequest.ErrorCode("usage_bound_exceeded"),
		)).Count(ctx)
		if err != nil {
			return out, err
		}
		if out.FailedNotices, err = s.DB.BudgetNotice.Query().Where(budgetnotice.TeamID(teamID), budgetnotice.StateEQ(budgetnotice.StateFailed)).Count(ctx); err != nil {
			return out, err
		}
	}
	rows, windows, err := s.current(ctx, teamID, userID, admin, now)
	if err != nil {
		return out, err
	}
	views := make([]WindowView, 0, len(windows))
	for _, w := range windows {
		views = append(views, windowView(rows, w))
		policy := windowPolicy(rows, w)
		if policy == nil || !policy.Enabled {
			continue
		}
		// The thresholds budget mail is sent at, so the overview and the mail agree.
		if t := crossed(w.SpentUnits, policy.PointLimit); t > 0 {
			out.NearLimit = append(out.NearLimit, LimitView{Scope: string(w.Scope), SubjectID: w.SubjectID, Period: string(w.Period), Threshold: t})
		}
	}
	out.Budget, err = summarizeQuota(rows, views, userID, now)
	return out, err
}
