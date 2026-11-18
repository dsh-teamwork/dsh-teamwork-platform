package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/usage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// rateCall authenticates before looking up the scoped model, including inline
// presets. A referenced preset always uses its model's rate, never an alias.
func (s *Server) rateCall(r *http.Request, admin bool) (usage.Call, error) {
	c, err := s.requireUser(r)
	if err != nil {
		return usage.Call{}, err
	}
	teamID := r.PathValue("teamId")
	if _, err := s.Team.RequireMembership(r.Context(), c.user.ID, teamID, admin); err != nil {
		return usage.Call{}, err
	}
	config, err := s.Team.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.ID(r.PathValue("configId")),
		teamconfig.KindIn(teamconfig.KindModel, teamconfig.KindPreset)).Only(r.Context())
	if ent.IsNotFound(err) {
		return usage.Call{}, wire.E(http.StatusNotFound, wire.ModelNotFound)
	}
	if err != nil {
		return usage.Call{}, err
	}
	var model struct {
		Provider      string `json:"provider"`
		Model         string `json:"model"`
		ModelConfigID string `json:"modelConfigId"`
	}
	if json.Unmarshal(config.Data, &model) != nil || model.ModelConfigID != "" {
		return usage.Call{}, wire.E(http.StatusBadRequest, "rate_model_required")
	}
	return usage.Call{TeamID: teamID, UserID: c.user.ID, ConfigID: config.ID, Provider: model.Provider, Model: model.Model, Owner: config.RouteOwner, Reference: config.RouteReference}, nil
}

func (s *Server) getModelRate(w http.ResponseWriter, r *http.Request) error {
	call, err := s.rateCall(r, false)
	if err != nil {
		return err
	}
	var v usage.RateView
	if call.Owner != "" {
		q, e := s.Usage.Quote(r.Context(), call.Owner, edition.ModelReference{TeamID: call.TeamID, ConfigID: call.ConfigID, Reference: call.Reference})
		if e != nil {
			return e
		}
		v = usage.QuoteRateView(q)
	} else {
		v, err = s.Usage.Rate(r.Context(), call.TeamID, call.ConfigID, call.Provider, call.Model)
	}
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) setModelRate(w http.ResponseWriter, r *http.Request) error {
	call, err := s.rateCall(r, true)
	if err != nil {
		return err
	}
	if call.Owner != "" {
		return wire.E(http.StatusForbidden, "config_owned")
	}
	var in usage.RateInput
	if err := decode(r, &in); err != nil {
		return err
	}
	v, err := s.Usage.SetRate(r.Context(), call, in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) usageFilter(r *http.Request) (usage.Filter, error) {
	c, err := s.requireUser(r)
	if err != nil {
		return usage.Filter{}, err
	}
	m, err := s.Team.RequireMembership(r.Context(), c.user.ID, r.PathValue("teamId"), false)
	if err != nil {
		return usage.Filter{}, err
	}
	query := r.URL.Query()
	f := usage.Filter{TeamID: m.TeamID, UserID: query.Get("userId"), ConfigID: query.Get("configId"), Page: 1, Size: 50}
	if m.Role != membership.RoleAdmin {
		f.UserID = c.user.ID
	}
	var issues wire.Issues
	for _, v := range []struct {
		key string
		n   *int
		max int
	}{{"page", &f.Page, 10000}, {"size", &f.Size, 200}} {
		if value := query.Get(v.key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > v.max {
				issues.Add("A valid page or size", v.key)
			} else {
				*v.n = n
			}
		}
	}
	for _, v := range []struct {
		key string
		at  *time.Time
	}{{"since", &f.Since}, {"until", &f.Until}} {
		if value := query.Get(v.key); value != "" {
			at, err := time.Parse(time.RFC3339, value)
			if err != nil {
				issues.Add("An RFC3339 timestamp", v.key)
			} else {
				*v.at = at
			}
		}
	}
	if !f.Since.IsZero() && !f.Until.IsZero() && !f.Until.After(f.Since) {
		issues.Add("until must be later than since", "until")
	}
	if err := issues.Err(); err != nil {
		return usage.Filter{}, err
	}
	return f, nil
}

// teamSummary is what waits on the caller and recent usage against the budgets
// that apply to them (usage.Summary). It is the caller's own by default, which
// is what the workspace's home shows everyone, an admin included; scope=team is
// the team's, for the admin's team overview (ADR 0049).
func (s *Server) teamSummary(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	scope := r.URL.Query().Get("scope")
	if scope != "" && scope != "me" && scope != "team" {
		var issues wire.Issues
		issues.Add("me or team", "scope")
		return issues.Err()
	}
	team := scope == "team"
	m, err := s.Team.RequireMembership(r.Context(), c.user.ID, r.PathValue("teamId"), team)
	if err != nil {
		return err
	}
	v := struct {
		usage.Summary
		PendingReviews int `json:"pendingReviews"`
	}{}
	if v.Summary, err = s.Usage.Summary(r.Context(), m.TeamID, c.user.ID, team); err != nil {
		return err
	}
	if v.PendingReviews, err = s.Team.PendingSubmissions(r.Context(), m.TeamID, c.user.ID, team); err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, v)
	return nil
}

// usageStats is a period's totals, days and models (usage.Stats), scoped as
// listUsage is: a member reads their own, an admin the team's or one member's.
// Without since and until it is the last 30 days; timezone (IANA, UTC by
// default) draws the days.
func (s *Server) usageStats(w http.ResponseWriter, r *http.Request) error {
	f, err := s.usageFilter(r)
	if err != nil {
		return err
	}
	if f.Until.IsZero() {
		f.Until = time.Now().UTC()
	}
	if f.Since.IsZero() {
		f.Since = f.Until.Add(-usage.SummaryPeriod)
	}
	var issues wire.Issues
	if f.Until.Sub(f.Since) > usage.MaxStatsSpan {
		issues.Add("At most 92 days", "since")
	}
	loc := time.UTC
	if name := r.URL.Query().Get("timezone"); name != "" {
		if loc, err = time.LoadLocation(name); err != nil || name == "Local" {
			loc = time.UTC
			issues.Add("An IANA time zone", "timezone")
		}
	}
	if err := issues.Err(); err != nil {
		return err
	}
	stats, err := s.Usage.Stats(r.Context(), f, loc)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, stats)
	return nil
}

func (s *Server) listUsage(w http.ResponseWriter, r *http.Request) error {
	f, err := s.usageFilter(r)
	if err != nil {
		return err
	}
	page, err := s.Usage.List(r.Context(), f)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, page)
	return nil
}
