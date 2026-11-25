package manage

import (
	"context"
	"sort"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
)

func weekStart(day time.Time) time.Time {
	return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
}

// ActivityInsights exposes daily collaboration and reliability without exposing user or team IDs.
func ActivityInsights(db *ent.Client) func(context.Context, edition.ActivityWindow) (edition.ActivityInsights, error) {
	return func(ctx context.Context, window edition.ActivityWindow) (edition.ActivityInsights, error) {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		return activityInsights(ctx, db, window)
	}
}

func activityInsights(ctx context.Context, db *ent.Client, window edition.ActivityWindow) (edition.ActivityInsights, error) {
	day, end := window.Start, window.End
	week := weekStart(day)
	weekEnd := week.AddDate(0, 0, 7)
	weekComplete := !weekEnd.After(window.AsOf)
	previousWeek, priorWeek := week.AddDate(0, 0, -7), week.AddDate(0, 0, -14)
	cohortDate, trailingDate := day.AddDate(0, 0, -7), day.AddDate(0, 0, -6)
	cohort, err := db.Team.Query().Where(team.CreatedAtGTE(cohortDate), team.CreatedAtLT(cohortDate.AddDate(0, 0, 1))).IDs(ctx)
	if err != nil {
		return edition.ActivityInsights{}, err
	}
	activation := make(map[string]bool, len(cohort))
	for _, id := range cohort {
		activation[id] = false
	}
	activeTeams, activeUsers := map[string]struct{}{}, map[string]struct{}{}
	trailingTeams, trailingUsers := map[string]struct{}{}, map[string]struct{}{}
	previous, prior := map[string]struct{}{}, map[string]struct{}{}
	firstCollaborator := map[string]string{}
	collaborating := map[string]struct{}{}
	errorsByCode := map[string]int{}
	spans := []int64{}
	upper := end
	if weekComplete {
		upper = weekEnd
	}
	cursor := ""
	for {
		rows, err := db.UsageRequest.Query().Where(usagerequest.IDGT(cursor), usagerequest.MeterEQ(""),
			usagerequest.CreatedAtGTE(priorWeek), usagerequest.CreatedAtLT(upper)).
			Select(usagerequest.FieldID, usagerequest.FieldCreatedAt, usagerequest.FieldFinishedAt, usagerequest.FieldTeamID,
				usagerequest.FieldUserID, usagerequest.FieldState, usagerequest.FieldErrorCode).
			Order(ent.Asc(usagerequest.FieldID)).Limit(500).All(ctx)
		if err != nil {
			return edition.ActivityInsights{}, err
		}
		for _, row := range rows {
			cursor = row.ID
			at, teamID, userID := row.CreatedAt, row.TeamID, row.UserID
			onDay := !at.Before(day) && at.Before(end)
			if onDay {
				if row.FinishedAt != nil {
					spans = append(spans, row.FinishedAt.Sub(at).Milliseconds())
				}
				if row.ErrorCode != "" {
					errorsByCode[row.ErrorCode]++
				}
			}
			if row.State != usagerequest.StateSettled || row.ErrorCode != "" {
				continue
			}
			if onDay {
				activeTeams[teamID], activeUsers[userID] = struct{}{}, struct{}{}
			}
			if !at.Before(trailingDate) && at.Before(end) {
				trailingTeams[teamID], trailingUsers[userID] = struct{}{}, struct{}{}
			}
			if _, ok := activation[teamID]; ok && !at.Before(cohortDate) && at.Before(day) {
				activation[teamID] = true
			}
			switch {
			case at.Before(previousWeek):
				prior[teamID] = struct{}{}
			case at.Before(week):
				previous[teamID] = struct{}{}
			case weekComplete:
				if first, ok := firstCollaborator[teamID]; !ok {
					firstCollaborator[teamID] = userID
				} else if first != userID {
					collaborating[teamID] = struct{}{}
				}
			}
		}
		if len(rows) < 500 {
			break
		}
	}

	coverage := map[string]string{"serverSpan": "server_span_not_upstream_latency"}
	var collaboratingTeams any
	if weekComplete {
		collaboratingTeams = len(collaborating)
	} else {
		coverage["collaboratingTeams"] = "week_incomplete"
	}
	var activated, retained int
	for _, ok := range activation {
		if ok {
			activated++
		}
	}
	for id := range prior {
		if _, ok := previous[id]; ok {
			retained++
		}
	}
	var suspensions []struct {
		TeamID   string `json:"team_id"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if err := db.UsageRequest.Query().Where(usagerequest.MeterEQ(""), usagerequest.ErrorCodeIn("usage_bound_exceeded", "usage_amount_overflow")).
		GroupBy(usagerequest.FieldTeamID, usagerequest.FieldProvider, usagerequest.FieldModel).Scan(ctx, &suspensions); err != nil {
		return edition.ActivityInsights{}, err
	}

	sort.Slice(spans, func(i, j int) bool { return spans[i] < spans[j] })
	var p50, p95 any
	if n := len(spans); n != 0 {
		p50, p95 = spans[(n-1)/2], spans[n-1-n/20]
	}
	type errorCount struct {
		Code  string `json:"code"`
		Count int    `json:"count"`
	}
	counts := make([]errorCount, 0, len(errorsByCode))
	for code, count := range errorsByCode {
		counts = append(counts, errorCount{code, count})
	}
	sort.Slice(counts, func(i, j int) bool {
		if counts[i].Count == counts[j].Count {
			return counts[i].Code < counts[j].Code
		}
		return counts[i].Count > counts[j].Count
	})
	limit, otherErrors := min(20, len(counts)), 0
	for _, entry := range counts[limit:] {
		otherErrors += entry.Count
	}
	return edition.ActivityInsights{
		Collaboration: map[string]any{
			"collaboratingTeams": collaboratingTeams, "activeTeams": len(activeTeams), "activeUsers": len(activeUsers),
			"trailing7d": map[string]int{"activeTeams": len(trailingTeams), "activeUsers": len(trailingUsers)},
			"activation": map[string]int{"teams": len(cohort), "activated": activated},
			"retention":  map[string]int{"priorActive": len(prior), "retained": retained},
		},
		Reliability: map[string]any{
			"serverSpanMs": map[string]any{"samples": len(spans), "p50": p50, "p95": p95},
			"errors":       map[string]any{"byCode": counts[:limit], "other": otherErrors},
		},
		BudgetSuspensions: len(suspensions),
		Coverage:          coverage,
	}, nil
}
