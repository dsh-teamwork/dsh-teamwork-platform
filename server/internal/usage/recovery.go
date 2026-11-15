package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetreservation"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type ResolutionInput struct {
	Reason string  `json:"reason"`
	Tokens Tokens  `json:"tokens"`
	Points *string `json:"points"`
}

func (in *ResolutionInput) Validate() error {
	in.Reason = strings.TrimSpace(in.Reason)
	var is wire.Issues
	if utf8.RuneCountInString(in.Reason) < 8 || utf8.RuneCountInString(in.Reason) > 500 {
		is.Add("A reason between 8 and 500 characters", "reason")
	}
	if !in.Tokens.Valid() {
		is.Add("Nonnegative, disjoint Token counts", "tokens")
	}
	if in.Points != nil {
		if _, err := Decimal(*in.Points, 9); err != nil {
			is.Add("Nonnegative points with at most nine decimal places", "points")
		}
	}
	return is.Err()
}

// Resolve is an explicit BYOK administrative estimate, not a claim that a
// missing supplier usage report was recovered. The complete prior record
// and actor/reason are retained before updating its display projection.
func (s *Service) Resolve(ctx context.Context, teamID, actorID, requestID string, in ResolutionInput) error {
	if err := in.Validate(); err != nil {
		return err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	db := tx.Client()
	if err := lockTeam(ctx, db, teamID); err != nil {
		return err
	}
	current, err := db.UsageRequest.Query().Where(usagerequest.ID(requestID), usagerequest.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(http.StatusNotFound, "usage_not_found")
	}
	if err != nil {
		return err
	}
	if current.State == usagerequest.StateRunning {
		return wire.E(http.StatusConflict, "usage_still_running")
	}
	if current.ErrorCode == "usage_bound_exceeded" && current.State == usagerequest.StateSettled {
		data, _ := json.Marshal(map[string]any{"before": current, "reason": in.Reason, "action": "route_reviewed"})
		if err := db.BudgetEvent.Create().SetTeamID(teamID).SetRequestID(current.ID).SetActorID(actorID).SetKind("resolve").
			SetActionKey("route-reviewed:" + current.ID).SetData(data).Exec(ctx); err != nil {
			return err
		}
		if err := db.UsageRequest.UpdateOneID(current.ID).SetErrorCode("usage_bound_resolved").Exec(ctx); err != nil {
			return err
		}
		return tx.Commit()
	}
	if current.State != usagerequest.StatePending && current.State != usagerequest.StateUnpriced {
		return wire.E(http.StatusConflict, "usage_already_resolved")
	}
	var amount *int64
	if in.Points != nil {
		n, _ := Decimal(*in.Points, 9)
		amount = &n
	} else if current.RateID != "" {
		var rates Rates
		if json.Unmarshal(current.Rates, &rates) != nil {
			return errors.New("invalid stored rate snapshot")
		}
		n, err := rates.Cost(in.Tokens)
		if err != nil {
			return wire.E(http.StatusBadRequest, "budget_amount_too_large")
		}
		amount = &n
	} else if in.Tokens.Input == 0 && in.Tokens.Output == 0 {
		zero := int64(0)
		amount = &zero
	}
	if amount == nil {
		return wire.E(http.StatusBadRequest, "usage_resolution_points_required")
	}
	rows, err := db.BudgetReservation.Query().Where(budgetreservation.RequestID(current.ID)).All(ctx)
	if err != nil {
		return err
	}
	for _, held := range rows {
		if !held.Settled {
			if err := settleWindow(ctx, db, current, held, in.Tokens, amount, s.now()); err != nil {
				return err
			}
		} else {
			if current.InputTokens == nil || current.OutputTokens == nil {
				return errors.New("unpriced request lacks observed token counts")
			}
			w, err := db.BudgetWindow.Get(ctx, held.WindowID)
			if err != nil {
				return err
			}
			delta := CounterDelta{SpentUnits: *amount, SpentInput: in.Tokens.Input - *current.InputTokens,
				SpentOutput: in.Tokens.Output - *current.OutputTokens, Unpriced: -1}
			if _, err := adjust(w.SpentUnits, delta.SpentUnits); err != nil {
				return err
			}
			if _, err := adjust(w.SpentInput, delta.SpentInput); err != nil {
				return err
			}
			if _, err := adjust(w.SpentOutput, delta.SpentOutput); err != nil || w.UnpricedCount < 1 {
				return errors.New("invalid unpriced adjustment counters")
			}
			if err := db.BudgetWindow.UpdateOneID(w.ID).AddSpentUnits(delta.SpentUnits).AddSpentInput(delta.SpentInput).
				AddSpentOutput(delta.SpentOutput).AddUnpricedCount(-1).Exec(ctx); err != nil {
				return err
			}
			data, _ := json.Marshal(delta)
			if err := db.BudgetEvent.Create().SetTeamID(teamID).SetWindowID(w.ID).SetRequestID(current.ID).SetActorID(actorID).
				SetKind("resolve").SetActionKey(fmt.Sprintf("resolve:%s:%s", current.ID, w.ID)).SetData(data).Exec(ctx); err != nil {
				return err
			}
			if err := enqueueNotices(ctx, db, w.ID, current.AppURL, s.now()); err != nil {
				return err
			}
		}
	}
	data, _ := json.Marshal(map[string]any{"before": current, "resolution": in})
	if err := db.BudgetEvent.Create().SetTeamID(teamID).SetRequestID(current.ID).SetActorID(actorID).
		SetKind("resolve").SetActionKey("resolution:" + current.ID).SetData(data).Exec(ctx); err != nil {
		return err
	}
	if err := db.UsageRequest.UpdateOneID(current.ID).SetState(usagerequest.StateEstimated).SetPointUnits(*amount).
		SetInputTokens(in.Tokens.Input).SetCacheReadTokens(in.Tokens.CacheRead).SetCacheWriteTokens(in.Tokens.CacheWrite).
		SetOutputTokens(in.Tokens.Output).SetReasoningTokens(in.Tokens.Reasoning).SetFinishedAt(s.now()).SetErrorCode("usage_manually_resolved").Exec(ctx); err != nil {
		return err
	}
	return tx.Commit()
}

func adjust(value, delta int64) (int64, error) {
	if delta >= 0 {
		return addProduct(value, delta, 1)
	}
	if value < -delta {
		return 0, errors.New("negative budget projection")
	}
	return value + delta, nil
}
