package usage

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/modelmeta"
)

// fundingTx is intentionally not an ent client. Its capability expires before
// commit/rollback, so a participant cannot retain and reuse it after a callback.
type fundingTx struct {
	db            *ent.Client
	teamID, owner string
	active        atomic.Bool
}

func (t *fundingTx) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
	if !t.active.Load() {
		return nil, sql.ErrTxDone
	}
	return t.db.ExecContext(ctx, q, args...)
}
func (t *fundingTx) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	if !t.active.Load() {
		return nil, sql.ErrTxDone
	}
	return t.db.QueryContext(ctx, q, args...)
}

// Participate borrows an existing transaction owned by the public caller. It
// neither starts nor commits one, including for a team not yet visible to peers.
func Participate(db *ent.Client, teamID, owner string, fn func(edition.SQLExecutor) error) error {
	t := &fundingTx{db: db, teamID: teamID, owner: owner}
	t.active.Store(true)
	defer t.active.Store(false)
	return fn(t)
}

// WithTeamTx orders extension financial work against inference in this team.
func (s *Service) WithTeamTx(ctx context.Context, teamID string, fn func(edition.SQLExecutor) error) error {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockTeam(ctx, tx.Client(), teamID); err != nil {
		return err
	}
	if err := Participate(tx.Client(), teamID, "", fn); err != nil {
		return err
	}
	return tx.Commit()
}

// RegisterFunding is called during extension mounting, before requests or
// maintenance can access the registry. No public configuration can register it.
func (s *Service) RegisterFunding(owner string, p edition.ModelFunding) (edition.FundingHost, error) {
	if owner == "" || len(owner) > 40 || p == nil {
		return edition.FundingHost{}, errors.New("invalid funding participant")
	}
	if s.Funding == nil {
		s.Funding = map[string]edition.ModelFunding{}
	}
	if s.Funding[owner] != nil {
		return edition.FundingHost{}, errors.New("duplicate funding participant")
	}
	s.Funding[owner] = p
	return edition.FundingHost{
		WithTeamTx: func(ctx context.Context, teamID string, fn func(edition.SQLExecutor) error) error {
			tx, err := s.DB.Tx(ctx)
			if err != nil {
				return err
			}
			defer tx.Rollback()
			if err := lockTeam(ctx, tx.Client(), teamID); err != nil {
				return err
			}
			if err := Participate(tx.Client(), teamID, owner, fn); err != nil {
				return err
			}
			return tx.Commit()
		},
		PublishModel: func(ctx context.Context, exec edition.SQLExecutor, teamID string, m edition.OwnedModel) error {
			tx, ok := exec.(*fundingTx)
			if !ok || !tx.active.Load() || tx.owner != owner || tx.teamID != teamID {
				return errors.New("model publication outside its team transaction")
			}
			if m.ConfigID == "" || len(m.ConfigID) > 32 || strings.TrimSpace(m.Name) == "" || utf8.RuneCountInString(m.Name) > 100 ||
				m.Reference == "" || len(m.Reference) > 100 || !teamTokens(m.ContextWindow) || !teamTokens(m.MaxTokens) || !modelmeta.ValidReasoningEfforts(m.ReasoningEfforts) {
				return errors.New("invalid owned model")
			}
			want := wire.ModelData{Provider: wire.HostedProvider, Model: m.Reference, ContextWindow: &m.ContextWindow, MaxTokens: &m.MaxTokens, Vision: m.Vision, Offline: m.Offline, ReasoningEfforts: slices.Clone(m.ReasoningEfforts)}
			if len(want.ReasoningEfforts) == 0 {
				want.ReasoningEfforts = nil
			}
			data, _ := json.Marshal(want)
			old, err := tx.db.TeamConfig.Query().Where(teamconfig.ID(m.ConfigID)).Only(ctx)
			if ent.IsNotFound(err) {
				if exists, err := tx.db.Team.Query().Where(team.ID(teamID)).Exist(ctx); err != nil || !exists {
					return cmp.Or(err, edition.ErrTeamGone)
				}
				return tx.db.TeamConfig.Create().SetID(m.ConfigID).SetTeamID(teamID).SetKind(teamconfig.KindModel).
					SetName(m.Name).SetData(data).SetRouteOwner(owner).SetRouteReference(m.Reference).Exec(ctx)
			}
			if err != nil {
				return err
			}
			if old.TeamID != teamID || old.RouteOwner != owner || old.RouteReference != m.Reference {
				return errors.New("owned model id belongs to another route")
			}
			// Compared as values: Postgres and MySQL store JSON in their own form.
			var had wire.ModelData
			if old.Name == m.Name && json.Unmarshal(old.Data, &had) == nil && reflect.DeepEqual(had, want) {
				return nil
			}
			// A new version is what tells a member's plugin to sync it again.
			return tx.db.TeamConfig.UpdateOne(old).SetName(m.Name).SetData(data).AddVersion(1).Exec(ctx)
		},
	}, nil
}

func (s *Service) Quote(ctx context.Context, owner string, ref edition.ModelReference) (edition.FundingQuote, error) {
	p := s.Funding[owner]
	if p == nil {
		return edition.FundingQuote{}, wire.E(http.StatusServiceUnavailable, "funding_unavailable")
	}
	q, err := p.Quote(ctx, ref)
	if err != nil {
		return edition.FundingQuote{}, err
	}
	if q.RateID == "" || len(q.RateID) > 32 || q.Model == "" || q.APIKey == "" || q.BaseURL == "" ||
		q.MaxInput <= 0 || q.MaxInput > MaxRouteInput || q.MaxOutput <= 0 || q.MaxOutput > MaxRouteOutput {
		return edition.FundingQuote{}, errors.New("invalid funding quote")
	}
	for k, v := range q.Body {
		if k == "model" || slices.Contains(ChatFields, k) || !json.Valid(v) {
			return edition.FundingQuote{}, errors.New("invalid funding quote")
		}
	}
	if _, err := q.Rates.Bound(1, 1); err != nil {
		return edition.FundingQuote{}, err
	}
	return q, nil
}

// teamTokens is the bound every team model's contextWindow and maxTokens keep
// (wire.ModelData), and the plugin reads.
func teamTokens(n int64) bool { return n >= 1 && n <= 10_000_000 }
