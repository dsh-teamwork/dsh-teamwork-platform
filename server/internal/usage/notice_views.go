package usage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type NoticeView struct {
	ID          string `json:"id"`
	RecipientID string `json:"recipientId"`
	Threshold   int    `json:"threshold"`
	State       string `json:"state"`
	CreatedAt   string `json:"createdAt"`
	NextAt      string `json:"nextAt"`
	ErrorCode   string `json:"code"`
}

func (s *Service) Notices(ctx context.Context, teamID, userID string, admin bool) ([]NoticeView, error) {
	q := s.DB.BudgetNotice.Query().Where(budgetnotice.TeamID(teamID))
	if !admin {
		q.Where(budgetnotice.RecipientID(userID))
	}
	rows, err := q.Order(ent.Desc(budgetnotice.FieldCreatedAt), ent.Desc(budgetnotice.FieldID)).Limit(30).All(ctx)
	if err != nil {
		return nil, err
	}
	views := []NoticeView{}
	for _, row := range rows {
		views = append(views, NoticeView{ID: row.ID, RecipientID: row.RecipientID, Threshold: row.Threshold, State: string(row.State),
			CreatedAt: row.CreatedAt.UTC().Format(time.RFC3339Nano), NextAt: row.NextAt.UTC().Format(time.RFC3339Nano), ErrorCode: row.LastError})
	}
	return views, nil
}

func (s *Service) RetryNotice(ctx context.Context, teamID, actorID, id string) error {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := s.now()
	row, err := tx.BudgetNotice.Query().Where(budgetnotice.ID(id), budgetnotice.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(http.StatusNotFound, "notice_not_found")
	}
	if err != nil {
		return err
	}
	if row.State != budgetnotice.StateFailed {
		return wire.E(http.StatusConflict, "notice_not_failed")
	}
	if row.NextAt.After(now) {
		refusal := wire.E(http.StatusTooManyRequests, "notice_retry_later")
		refusal.ResetAt = &row.NextAt
		return refusal
	}
	changed, err := tx.BudgetNotice.Update().Where(budgetnotice.ID(id), budgetnotice.StateEQ(budgetnotice.StateFailed), budgetnotice.NextAtLTE(now)).
		SetState(budgetnotice.StatePending).SetAttempts(0).SetNextAt(now).SetLastError("").SetLeaseID("").ClearLeaseUntil().Save(ctx)
	if err != nil {
		return err
	}
	if changed != 1 {
		return wire.E(http.StatusConflict, "notice_not_failed")
	}
	data, _ := json.Marshal(map[string]any{"noticeId": id, "action": "retry"})
	if err := tx.BudgetEvent.Create().SetTeamID(teamID).SetActorID(actorID).SetKind("resolve").
		SetActionKey(fmt.Sprintf("notice-retry:%s:%d", id, now.UnixNano())).SetData(data).Exec(ctx); err != nil {
		return err
	}
	return tx.Commit()
}
