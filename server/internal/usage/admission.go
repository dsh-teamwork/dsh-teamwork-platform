package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func applicable(ctx context.Context, db *ent.Client, call Call) ([]*ent.BudgetPolicy, error) {
	policies, err := db.BudgetPolicy.Query().Where(budgetpolicy.TeamID(call.TeamID), budgetpolicy.Or(
		budgetpolicy.ScopeEQ(budgetpolicy.ScopeTeam), budgetpolicy.ScopeEQ(budgetpolicy.ScopeDefaultMember),
		budgetpolicy.And(budgetpolicy.ScopeEQ(budgetpolicy.ScopeMember), budgetpolicy.SubjectID(call.UserID)),
		budgetpolicy.And(budgetpolicy.ScopeEQ(budgetpolicy.ScopeProvider), budgetpolicy.SubjectID(call.Provider)),
	)).All(ctx)
	if err != nil {
		return nil, err
	}
	return selectPolicies(policies), nil
}

func selectPolicies(policies []*ent.BudgetPolicy) []*ent.BudgetPolicy {
	overrides := map[budgetpolicy.Period]bool{}
	defaults := map[budgetpolicy.Period]bool{}
	for _, p := range policies {
		if p.Scope == budgetpolicy.ScopeDefaultMember {
			defaults[p.Period] = true
		}
	}
	for _, p := range policies {
		if p.Scope == budgetpolicy.ScopeMember && !inheritsDefault(p) {
			overrides[p.Period] = true
		}
	}
	selected := policies[:0]
	for _, p := range policies {
		if p.Scope == budgetpolicy.ScopeMember && inheritsDefault(p) && defaults[p.Period] {
			continue
		}
		if p.Scope == budgetpolicy.ScopeDefaultMember && overrides[p.Period] {
			continue
		}
		selected = append(selected, p)
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].ID < selected[j].ID })
	return selected
}

func fits(limit *int64, spent, reserved, requested int64) bool {
	if limit == nil {
		return true
	}
	if spent < 0 || reserved < 0 || requested < 0 || requested > *limit {
		return false
	}
	available := *limit - requested
	return spent <= available && reserved <= available-spent
}

func limitError(code string, p *ent.BudgetPolicy, w *ent.BudgetWindow) error {
	e := wire.E(http.StatusForbidden, code)
	e.Scope = string(p.Scope)
	if w != nil {
		end := w.EndsAt
		e.ResetAt = &end
	}
	return e
}

// CounterDelta is durable evidence sufficient to reconstruct a window's
// projections. It contains no prompt, response text or provider secret.
type CounterDelta struct {
	SpentUnits, ReservedUnits   int64
	SpentInput, ReservedInput   int64
	SpentOutput, ReservedOutput int64
	Unpriced, Unbounded         int64
}

func (s *Service) admit(ctx context.Context, call Call) (*ent.UsageRequest, error) {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	db := tx.Client()
	if err := lockTeam(ctx, db, call.TeamID); err != nil {
		return nil, err
	}
	policies, err := applicable(ctx, db, call)
	if err != nil {
		return nil, err
	}
	scoped := &Service{DB: db, Now: s.Now}
	rate, err := scoped.latestRate(ctx, call.TeamID, call.ConfigID)
	if err != nil {
		return nil, err
	}
	priced := rate != nil && rate.Provider == call.Provider && rate.Model == call.Model
	var rates Rates
	rateID := ""
	if priced {
		rates, rateID = ratesOf(rate), rate.ID
	}
	if call.Owner != "" {
		if s.Funding[call.Owner] == nil || call.Quote == nil {
			return nil, wire.E(http.StatusServiceUnavailable, "funding_unavailable")
		}
		rates, rateID, priced = call.Quote.Rates, call.Quote.RateID, true
	}
	var bound Tokens
	bounded := false
	needBound := call.Owner != ""
	for _, p := range policies {
		if p.Enabled && p.PointLimit != nil && !priced {
			return nil, limitError("budget_model_unpriced", p, nil)
		}
		needBound = needBound || p.Enabled
	}
	if needBound {
		suspended, e := db.UsageRequest.Query().Where(usagerequest.TeamID(call.TeamID), usagerequest.Provider(call.Provider), usagerequest.Model(call.Model), usagerequest.ErrorCodeIn("usage_bound_exceeded", "usage_amount_overflow")).Exist(ctx)
		if e != nil {
			return nil, e
		}
		if suspended {
			return nil, wire.E(http.StatusForbidden, "budget_route_suspended")
		}
		if call.Bounds == nil {
			return nil, wire.E(http.StatusForbidden, "budget_bound_unavailable")
		}
		bound, err = call.Bounds()
		if err != nil {
			return nil, err
		}
		if !bound.Valid() || bound.Input <= 0 || bound.Output <= 0 {
			return nil, errors.New("invalid trusted route bound")
		}
		bounded = true
	}
	var heldUnits int64
	if bounded && priced {
		heldUnits, err = rates.Bound(bound.Input, bound.Output)
		if err != nil {
			return nil, wire.E(http.StatusBadRequest, "budget_amount_too_large")
		}
	}
	now := s.now()
	create := db.UsageRequest.Create().SetCreatedAt(now).SetDeadlineAt(now.Add(MaxCallDuration)).SetAppURL(s.AppURL).SetTeamID(call.TeamID).SetUserID(call.UserID).
		SetSubmittedConfigID(call.SubmittedConfigID).SetConfigID(call.ConfigID).
		SetProvider(call.Provider).SetModel(call.Model).SetStream(call.Stream).SetRouteOwner(call.Owner)
	if priced {
		data, _ := json.Marshal(rates)
		create.SetRateID(rateID).SetRates(data)
	}
	if bounded {
		create.SetAdmittedInput(bound.Input).SetAdmittedOutput(bound.Output).SetAdmittedUnits(heldUnits)
	}
	request, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	for _, p := range policies {
		w, err := window(ctx, db, p, call.UserID, now)
		if err != nil {
			return nil, err
		}
		if p.Enabled {
			if w.UnboundedCount > 0 || p.PointLimit != nil && w.UnpricedCount > 0 {
				return nil, limitError("budget_pending_usage", p, w)
			}
			spentTotal, e1 := addProduct(w.SpentInput, w.SpentOutput, 1)
			reservedTotal, e2 := addProduct(w.ReservedInput, w.ReservedOutput, 1)
			if e1 != nil || e2 != nil {
				return nil, errors.New("budget token counters overflowed")
			}
			if !fits(p.PointLimit, w.SpentUnits, w.ReservedUnits, heldUnits) ||
				!fits(p.InputLimit, w.SpentInput, w.ReservedInput, bound.Input) ||
				!fits(p.OutputLimit, w.SpentOutput, w.ReservedOutput, bound.Output) ||
				!fits(p.TotalLimit, spentTotal, reservedTotal, bound.Input+bound.Output) {
				return nil, limitError("budget_exhausted", p, w)
			}
		}
		for _, pair := range [][2]int64{{w.ReservedUnits, heldUnits}, {w.ReservedInput, bound.Input}, {w.ReservedOutput, bound.Output}} {
			if _, err := addProduct(pair[0], pair[1], 1); err != nil {
				return nil, wire.E(http.StatusBadRequest, "budget_amount_too_large")
			}
		}
		unbounded := !bounded
		n := int64(0)
		if unbounded {
			n = 1
		}
		unpriced := int64(0)
		if !priced {
			unpriced = 1
		}
		// The team guard protects policy selection; these conditional updates
		// also prove the counters did not change after the cap comparison.
		changed, err := db.BudgetWindow.Update().Where(budgetwindow.ID(w.ID),
			budgetwindow.SpentUnits(w.SpentUnits), budgetwindow.ReservedUnits(w.ReservedUnits),
			budgetwindow.SpentInput(w.SpentInput), budgetwindow.ReservedInput(w.ReservedInput),
			budgetwindow.SpentOutput(w.SpentOutput), budgetwindow.ReservedOutput(w.ReservedOutput)).
			AddReservedUnits(heldUnits).AddReservedInput(bound.Input).AddReservedOutput(bound.Output).AddUnboundedCount(n).AddUnpricedCount(unpriced).Save(ctx)
		if err != nil {
			return nil, err
		}
		if changed != 1 {
			return nil, errors.New("budget counters changed during admission")
		}
		if err := db.BudgetReservation.Create().SetRequestID(request.ID).SetWindowID(w.ID).
			SetPolicyID(p.ID).SetPolicyRevision(p.Revision).SetPointUnits(heldUnits).
			SetInputTokens(bound.Input).SetOutputTokens(bound.Output).SetUnbounded(unbounded).SetUnpriced(!priced).Exec(ctx); err != nil {
			return nil, err
		}
		data, _ := json.Marshal(CounterDelta{ReservedUnits: heldUnits, ReservedInput: bound.Input, ReservedOutput: bound.Output, Unbounded: n, Unpriced: unpriced})
		if err := db.BudgetEvent.Create().SetCreatedAt(now).SetTeamID(call.TeamID).SetWindowID(w.ID).
			SetRequestID(request.ID).SetPolicyID(p.ID).SetKind("reserve").
			SetActionKey(fmt.Sprintf("reserve:%s:%s", request.ID, w.ID)).SetData(data).Exec(ctx); err != nil {
			return nil, err
		}
	}
	if call.Owner != "" {
		in := edition.FundingAdmission{RequestID: request.ID, TeamID: call.TeamID, UserID: call.UserID, ConfigID: call.ConfigID, Reference: call.Reference, Model: call.Model, RateID: rateID, HeldUnits: heldUnits}
		if err := participate(db, call.TeamID, call.Owner, func(tx edition.SQLExecutor) error { return s.Funding[call.Owner].Reserve(ctx, tx, in) }); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return request, nil
}
