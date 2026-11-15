package usage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
	_ "time/tzdata" // Released binaries must resolve IANA zones without host files.
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type PolicyInput struct {
	Scope     string  `json:"scope"`
	SubjectID string  `json:"subjectId"`
	Period    string  `json:"period"`
	Timezone  string  `json:"timezone"`
	Revision  int     `json:"revision"`
	Enabled   bool    `json:"enabled"`
	Notify    string  `json:"notify"`
	Points    *string `json:"points"`
	Input     *int64  `json:"input"`
	Output    *int64  `json:"output"`
	Total     *int64  `json:"total"`
}

func (in *PolicyInput) Validate() error {
	var is wire.Issues
	if in.Notify == "" {
		in.Notify = "admins"
		if in.Scope == "member" || in.Scope == "default_member" {
			in.Notify = "both"
		}
	}
	if in.Notify == "both" && (in.Scope == "team" || in.Scope == "provider") {
		in.Notify = "admins"
	}
	if in.Notify != "admins" && in.Notify != "owner" && in.Notify != "both" && in.Notify != "none" ||
		in.Notify == "owner" && in.Scope != "member" && in.Scope != "default_member" {
		is.Add("A supported notification audience", "notify")
	}
	if in.Scope != "team" && in.Scope != "member" && in.Scope != "default_member" && in.Scope != "provider" {
		is.Add("A valid budget scope", "scope")
	}
	if (in.Scope == "team" || in.Scope == "default_member") && in.SubjectID != "" ||
		(in.Scope == "member" || in.Scope == "provider") && (in.SubjectID == "" || utf8.RuneCountInString(in.SubjectID) > 100) {
		is.Add("A subject belonging to this budget scope", "subjectId")
	}
	if in.Period != "day" && in.Period != "month" {
		is.Add("day or month", "period")
	}
	if len(in.Timezone) > 100 {
		is.Add("An IANA timezone", "timezone")
	} else if _, err := time.LoadLocation(in.Timezone); err != nil || in.Timezone == "" || in.Timezone == "Local" {
		is.Add("An explicit IANA timezone", "timezone")
	}
	if in.Revision < 0 || in.Revision > 1_000_000_000 {
		is.Add("A valid budget revision", "revision")
	}
	if in.Points != nil {
		if _, err := Decimal(*in.Points, 9); err != nil {
			is.Add("Nonnegative points with at most nine decimal places", "points")
		}
	}
	for _, p := range []struct {
		name string
		n    *int64
	}{{"input", in.Input}, {"output", in.Output}, {"total", in.Total}} {
		if p.n != nil && (*p.n < 0 || *p.n > 1_000_000_000_000) {
			is.Add("A whole Token cap from 0 to 1000000000000", p.name)
		}
	}
	if in.Enabled && in.Points == nil && in.Input == nil && in.Output == nil && in.Total == nil {
		is.Add("At least one cap is required for an enabled budget", "points")
	}
	return is.Err()
}

// PolicyView reports a scheduled timezone separately from its currently active
// timezone. Changing timezone never opens a fresh allowance mid-window.
type PolicyView struct {
	ID string `json:"id"`
	PolicyInput
	ActiveTimezone  string  `json:"activeTimezone"`
	EffectiveAt     *string `json:"effectiveAt"`
	InheritsDefault bool    `json:"inheritsDefault"`
}

func inheritsDefault(p *ent.BudgetPolicy) bool {
	return p.Scope == budgetpolicy.ScopeMember && !p.Enabled && p.PointLimit == nil &&
		p.InputLimit == nil && p.OutputLimit == nil && p.TotalLimit == nil
}

func policyView(p *ent.BudgetPolicy, now time.Time) PolicyView {
	v := PolicyView{ID: p.ID, InheritsDefault: inheritsDefault(p), PolicyInput: PolicyInput{Scope: string(p.Scope), SubjectID: p.SubjectID,
		Period: string(p.Period), Timezone: p.Timezone, Revision: p.Revision, Enabled: p.Enabled, Notify: string(p.Notify),
		Input: p.InputLimit, Output: p.OutputLimit, Total: p.TotalLimit}, ActiveTimezone: p.Timezone}
	if p.PointLimit != nil {
		points := FormatPoints(*p.PointLimit)
		v.Points = &points
	}
	if p.TimezoneEffectiveAt != nil && now.Before(*p.TimezoneEffectiveAt) {
		v.ActiveTimezone = p.PreviousTimezone
		at := p.TimezoneEffectiveAt.UTC().Format(time.RFC3339Nano)
		v.EffectiveAt = &at
	}
	return v
}

func calendarWindow(now time.Time, zone, period string) (time.Time, time.Time, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	local := now.In(loc)
	day := local.Day()
	if period == "month" {
		day = 1
	}
	start := time.Date(local.Year(), local.Month(), day, 0, 0, 0, 0, loc)
	end := start.AddDate(0, 0, 1)
	if period == "month" {
		end = start.AddDate(0, 1, 0)
	}
	return start.UTC(), end.UTC(), nil
}

func lockTeam(ctx context.Context, db *ent.Client, teamID string) error {
	// Ignore returns the existing row on every dialect. DO NOTHING with ent's
	// RETURNING path reports sql.ErrNoRows on PostgreSQL/SQLite conflicts.
	if err := db.BudgetGate.Create().SetID(teamID).OnConflictColumns("id").Ignore().Exec(ctx); err != nil {
		return err
	}
	return db.BudgetGate.UpdateOneID(teamID).AddRevision(1).Exec(ctx)
}

func (s *Service) SetPolicy(ctx context.Context, teamID, actorID string, in PolicyInput) (PolicyView, error) {
	if err := in.Validate(); err != nil {
		return PolicyView{}, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return PolicyView{}, err
	}
	defer tx.Rollback()
	db := tx.Client()
	if err := lockTeam(ctx, db, teamID); err != nil {
		return PolicyView{}, err
	}
	p, err := db.BudgetPolicy.Query().Where(budgetpolicy.TeamID(teamID), budgetpolicy.ScopeEQ(budgetpolicy.Scope(in.Scope)),
		budgetpolicy.SubjectID(in.SubjectID), budgetpolicy.PeriodEQ(budgetpolicy.Period(in.Period))).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return PolicyView{}, err
	}
	before := p
	if p == nil && in.Revision != 0 || p != nil && p.Revision != in.Revision {
		return PolicyView{}, wire.E(http.StatusConflict, "budget_changed")
	}
	now := s.now()
	var pointLimit *int64
	if in.Points != nil {
		n, _ := Decimal(*in.Points, 9)
		pointLimit = &n
	}
	if p == nil {
		p, err = db.BudgetPolicy.Create().SetCreatedAt(now).SetUpdatedAt(now).SetTeamID(teamID).
			SetScope(budgetpolicy.Scope(in.Scope)).SetSubjectID(in.SubjectID).SetPeriod(budgetpolicy.Period(in.Period)).
			SetTimezone(in.Timezone).SetEnabled(in.Enabled).SetNotify(budgetpolicy.Notify(in.Notify)).SetNillablePointLimit(pointLimit).
			SetNillableInputLimit(in.Input).SetNillableOutputLimit(in.Output).SetNillableTotalLimit(in.Total).Save(ctx)
	} else {
		update := db.BudgetPolicy.UpdateOneID(p.ID).SetUpdatedAt(now).AddRevision(1).SetEnabled(in.Enabled).SetNotify(budgetpolicy.Notify(in.Notify)).
			ClearPointLimit().ClearInputLimit().ClearOutputLimit().ClearTotalLimit().
			SetNillablePointLimit(pointLimit).SetNillableInputLimit(in.Input).SetNillableOutputLimit(in.Output).SetNillableTotalLimit(in.Total)
		if in.Timezone != p.Timezone {
			active := policyView(p, now).ActiveTimezone
			_, boundary, e := calendarWindow(now, active, in.Period)
			if e != nil {
				return PolicyView{}, e
			}
			if p.TimezoneEffectiveAt != nil && now.Before(*p.TimezoneEffectiveAt) {
				boundary = *p.TimezoneEffectiveAt
			}
			update.SetPreviousTimezone(active).SetTimezone(in.Timezone).SetTimezoneEffectiveAt(boundary)
		}
		p, err = update.Save(ctx)
	}
	if err != nil {
		return PolicyView{}, err
	}
	data, _ := json.Marshal(map[string]any{"before": before, "after": p})
	if err := db.BudgetEvent.Create().SetTeamID(teamID).SetPolicyID(p.ID).SetActorID(actorID).
		SetKind("policy").SetActionKey(fmt.Sprintf("policy:%s:%d", p.ID, p.Revision)).SetData(data).Exec(ctx); err != nil {
		return PolicyView{}, err
	}
	if err := tx.Commit(); err != nil {
		return PolicyView{}, err
	}
	return policyView(p, now), nil
}

// window reuses an active scope window even when its default policy was replaced
// by a member override. A new policy starts counting at activation, not before.
func window(ctx context.Context, db *ent.Client, p *ent.BudgetPolicy, userID string, now time.Time) (*ent.BudgetWindow, error) {
	scope, subject := string(p.Scope), p.SubjectID
	if scope == "default_member" {
		scope, subject = "member", userID
	}
	last, err := db.BudgetWindow.Query().Where(budgetwindow.TeamID(p.TeamID), budgetwindow.ScopeEQ(budgetwindow.Scope(scope)),
		budgetwindow.SubjectID(subject), budgetwindow.PeriodEQ(budgetwindow.Period(p.Period))).Order(ent.Desc(budgetwindow.FieldEndsAt)).First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if last != nil && now.Before(last.StartsAt) {
		return nil, fmt.Errorf("budget clock moved before the current window")
	}
	if last != nil && now.Before(last.EndsAt) {
		return last, nil
	}
	start, end, err := calendarWindow(now, policyView(p, now).ActiveTimezone, string(p.Period))
	if err != nil {
		return nil, err
	}
	if last != nil && last.EndsAt.After(start) {
		start = last.EndsAt
	}
	if p.CreatedAt.After(start) {
		start = p.CreatedAt
	}
	if p.TimezoneEffectiveAt != nil && !now.Before(*p.TimezoneEffectiveAt) && p.TimezoneEffectiveAt.After(start) {
		start = *p.TimezoneEffectiveAt
	}
	if start.After(now) || !end.After(start) {
		return nil, fmt.Errorf("invalid budget window boundaries")
	}
	return db.BudgetWindow.Create().SetTeamID(p.TeamID).SetScope(budgetwindow.Scope(scope)).SetSubjectID(subject).
		SetPeriod(budgetwindow.Period(p.Period)).SetStartsAt(start).SetEndsAt(end).Save(ctx)
}
