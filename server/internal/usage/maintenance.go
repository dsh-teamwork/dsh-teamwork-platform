package usage

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
)

// MarkLost only changes observability. A dead process or expired deadline never
// authorizes releasing a potentially billed request's reserved resources.
func (s *Service) MarkLost(ctx context.Context) error {
	now := s.now()
	cutoff := now.Add(-30 * time.Second)
	rows, err := s.DB.UsageRequest.Query().Where(usagerequest.StateEQ(usagerequest.StateRunning), usagerequest.Or(
		usagerequest.DeadlineAtLTE(cutoff), usagerequest.And(usagerequest.DeadlineAtIsNil(), usagerequest.CreatedAtLT(cutoff.Add(-MaxCallDuration))),
	)).Limit(100).All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		tx, err := s.DB.Tx(ctx)
		if err != nil {
			return err
		}
		err = func() error {
			defer tx.Rollback()
			db := tx.Client()
			if err := lockTeam(ctx, db, row.TeamID); err != nil {
				return err
			}
			changed, err := db.UsageRequest.Update().Where(usagerequest.ID(row.ID), usagerequest.StateEQ(usagerequest.StateRunning)).
				SetState(usagerequest.StatePending).SetFinishedAt(now).SetErrorCode("request_lost").Save(ctx)
			if err != nil || changed == 0 {
				return err
			}
			data, _ := json.Marshal(map[string]any{"code": "request_lost", "deadline": row.DeadlineAt, "holdsRetained": true})
			if err := db.BudgetEvent.Create().SetTeamID(row.TeamID).SetRequestID(row.ID).SetKind("pending").
				SetActionKey("lost:" + row.ID).SetData(data).Exec(ctx); err != nil {
				return err
			}
			return tx.Commit()
		}()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) StartMaintenance() func() {
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			step, stop := context.WithTimeout(ctx, 15*time.Second)
			err := s.MarkLost(step)
			if err == nil {
				err = s.DeliverNotices(step)
			}
			stop()
			if err != nil && ctx.Err() == nil {
				slog.Error("usage maintenance failed", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); wg.Wait() }
}
