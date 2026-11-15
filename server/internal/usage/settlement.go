package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetreservation"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
)

func (s *Service) settle(ctx context.Context, request *ent.UsageRequest, observation Observation, code string) error {
	if observation.Known && !observation.Tokens.Valid() {
		observation.Invalid = true
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	db := tx.Client()
	if err := lockTeam(ctx, db, request.TeamID); err != nil {
		return err
	}
	current, err := db.UsageRequest.Get(ctx, request.ID)
	if err != nil {
		return err
	}
	if current.State == usagerequest.StateEstimated && observation.Known && observation.Complete && !observation.Invalid {
		data, _ := json.Marshal(observation)
		if err := db.BudgetEvent.Create().SetTeamID(current.TeamID).SetRequestID(current.ID).SetKind("late_usage").
			SetActionKey("late-usage:" + current.ID).SetData(data).OnConflictColumns("action_key").Ignore().Exec(ctx); err != nil {
			return err
		}
		return tx.Commit()
	}
	if current.State != usagerequest.StateRunning && !(current.State == usagerequest.StatePending && observation.Known && observation.Complete && !observation.Invalid) {
		return nil
	}
	state := usagerequest.StatePending
	var units *int64
	if observation.Known && observation.Complete && !observation.Invalid {
		state = usagerequest.StateUnpriced
		if current.RateID != "" {
			var rates Rates
			if err := json.Unmarshal(current.Rates, &rates); err != nil {
				return errors.New("invalid stored rate snapshot")
			}
			amount, err := rates.Cost(observation.Tokens)
			if err != nil {
				state, code = usagerequest.StatePending, "usage_amount_overflow"
			} else {
				units, state = &amount, usagerequest.StateSettled
			}
		}
	}
	if state == usagerequest.StateSettled || state == usagerequest.StateUnpriced {
		if current.AdmittedInput != nil && current.AdmittedOutput != nil &&
			(observation.Tokens.Input > *current.AdmittedInput || observation.Tokens.Output > *current.AdmittedOutput ||
				units != nil && current.AdmittedUnits != nil && *units > *current.AdmittedUnits) {
			code = "usage_bound_exceeded"
		}
		if current.RouteOwner != "" {
			p := s.Funding[current.RouteOwner]
			if p == nil || units == nil {
				return errors.New("funding participant unavailable for settlement")
			}
			if err := participate(db, current.TeamID, current.RouteOwner, func(tx edition.SQLExecutor) error {
				return p.Settle(ctx, tx, edition.FundingSettlement{RequestID: current.ID, TeamID: current.TeamID, Units: *units, Tokens: observation.Tokens})
			}); err != nil {
				return err
			}
		}
		reservations, err := db.BudgetReservation.Query().Where(budgetreservation.RequestID(current.ID), budgetreservation.Settled(false)).All(ctx)
		if err != nil {
			return err
		}
		for _, held := range reservations {
			if !held.Unbounded && (observation.Tokens.Input > held.InputTokens || observation.Tokens.Output > held.OutputTokens ||
				units != nil && *units > held.PointUnits) {
				code = "usage_bound_exceeded"
			}
			if err := settleWindow(ctx, db, current, held, observation.Tokens, units, s.now()); err != nil {
				return err
			}
		}
	}
	b := db.UsageRequest.Update().Where(usagerequest.ID(current.ID), usagerequest.StateIn(usagerequest.StateRunning, usagerequest.StatePending)).
		SetState(state).SetFinishedAt(s.now()).SetErrorCode(code).SetProviderRequestID(observation.ID).SetNillablePointUnits(units)
	if observation.Known && !observation.Invalid {
		t := observation.Tokens
		b.SetInputTokens(t.Input).SetCacheReadTokens(t.CacheRead).SetCacheWriteTokens(t.CacheWrite).SetOutputTokens(t.Output).SetReasoningTokens(t.Reasoning)
	}
	changed, err := b.Save(ctx)
	if err != nil {
		return err
	}
	if changed != 1 {
		return errors.New("usage changed during settlement")
	}
	return tx.Commit()
}

func settleWindow(ctx context.Context, db *ent.Client, request *ent.UsageRequest, held *ent.BudgetReservation, tokens Tokens, units *int64, now time.Time) error {
	w, err := db.BudgetWindow.Get(ctx, held.WindowID)
	if err != nil {
		return err
	}
	amount := int64(0)
	if units != nil {
		amount = *units
	}
	for _, pair := range [][2]int64{{w.SpentUnits, amount}, {w.SpentInput, tokens.Input}, {w.SpentOutput, tokens.Output}} {
		if _, err := addProduct(pair[0], pair[1], 1); err != nil {
			return err
		}
	}
	unbounded := int64(0)
	if held.Unbounded {
		unbounded = -1
	}
	unpriced := int64(0)
	if held.Unpriced && units != nil {
		unpriced = -1
	}
	if w.ReservedUnits < held.PointUnits || w.ReservedInput < held.InputTokens || w.ReservedOutput < held.OutputTokens || w.UnboundedCount+unbounded < 0 || w.UnpricedCount+unpriced < 0 {
		return errors.New("invalid budget reservation counters")
	}
	if err := db.BudgetWindow.UpdateOneID(w.ID).AddReservedUnits(-held.PointUnits).AddReservedInput(-held.InputTokens).
		AddReservedOutput(-held.OutputTokens).AddSpentUnits(amount).AddSpentInput(tokens.Input).AddSpentOutput(tokens.Output).
		AddUnboundedCount(unbounded).AddUnpricedCount(unpriced).Exec(ctx); err != nil {
		return err
	}
	if err := db.BudgetReservation.UpdateOneID(held.ID).SetSettled(true).Exec(ctx); err != nil {
		return err
	}
	data, _ := json.Marshal(CounterDelta{SpentUnits: amount, ReservedUnits: -held.PointUnits,
		SpentInput: tokens.Input, ReservedInput: -held.InputTokens, SpentOutput: tokens.Output, ReservedOutput: -held.OutputTokens, Unbounded: unbounded, Unpriced: unpriced})
	if err := db.BudgetEvent.Create().SetTeamID(request.TeamID).SetWindowID(w.ID).SetRequestID(request.ID).SetPolicyID(held.PolicyID).
		SetKind("settle").SetActionKey(fmt.Sprintf("settle:%s:%s", request.ID, w.ID)).SetData(data).Exec(ctx); err != nil {
		return err
	}
	return enqueueNotices(ctx, db, w.ID, request.AppURL, now)
}
