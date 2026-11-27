// Package contentfence prevents a write admitted before a team's content reset
// from committing after it. HTTP admission supplies the generation; the ent
// driver checks it in the same transaction immediately before commit.
package contentfence

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type admissionKey struct{}

type admission struct {
	teamID     string
	generation int64
}

// Fence admits writes and lets an edition refuse them while its team resets.
type Fence struct {
	DB      *sql.DB
	Dialect string
	Guard   func(context.Context, string) error
}

func New(db *sql.DB, dialect string) *Fence { return &Fence{DB: db, Dialect: dialect} }

// Admit returns a context carrying the team's generation at admission. A
// missing team has the public not-found shape before a handler runs.
func (f *Fence) Admit(ctx context.Context, teamID string) (context.Context, error) {
	if teamID == "" {
		return ctx, nil
	}
	if f.Guard != nil {
		if err := f.Guard(ctx, teamID); err != nil {
			return nil, err
		}
	}
	query, args := entsql.Dialect(f.Dialect).Select("content_generation").From(entsql.Table("teams")).Where(entsql.EQ("id", teamID)).Query()
	var generation int64
	if err := f.DB.QueryRowContext(ctx, query, args...).Scan(&generation); errors.Is(err, sql.ErrNoRows) {
		return nil, wire.E(http.StatusNotFound, wire.TeamNotFound)
	} else if err != nil {
		return nil, err
	}
	return context.WithValue(ctx, admissionKey{}, admission{teamID: teamID, generation: generation}), nil
}

// Driver wraps an ent driver. Transactions without an admission are unchanged.
type Driver struct {
	dialect.Driver
	dialectName string
}

func NewDriver(driver dialect.Driver, dialectName string) *Driver {
	return &Driver{Driver: driver, dialectName: dialectName}
}

func (d *Driver) Tx(ctx context.Context) (dialect.Tx, error) {
	tx, err := d.Driver.Tx(ctx)
	if err != nil {
		return nil, err
	}
	admitted, ok := ctx.Value(admissionKey{}).(admission)
	if !ok {
		return tx, nil
	}
	return &guardedTx{Tx: tx, ctx: ctx, admitted: admitted, dialectName: d.dialectName}, nil
}

type guardedTx struct {
	dialect.Tx
	ctx         context.Context
	admitted    admission
	dialectName string
}

func (tx *guardedTx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return tx.Tx.(interface {
		ExecContext(context.Context, string, ...any) (sql.Result, error)
	}).ExecContext(ctx, query, args...)
}

func (tx *guardedTx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return tx.Tx.(interface {
		QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	}).QueryContext(ctx, query, args...)
}

func (tx *guardedTx) Commit() error {
	builder := entsql.Dialect(tx.dialectName)
	read := builder.Select("content_generation").From(entsql.Table("teams")).Where(entsql.EQ("id", tx.admitted.teamID))
	if tx.dialectName != dialect.SQLite {
		read.ForUpdate()
	}
	query, args := read.Query()
	rows, err := tx.Tx.(interface {
		QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	}).QueryContext(tx.ctx, query, args...)
	if err != nil {
		tx.Rollback()
		return err
	}
	var generation int64
	if !rows.Next() {
		tx.Rollback()
		return wire.E(http.StatusConflict, "team_resetting")
	}
	if err := rows.Scan(&generation); err != nil {
		tx.Rollback()
		return err
	}
	if generation != tx.admitted.generation {
		tx.Rollback()
		return wire.E(http.StatusConflict, "team_resetting")
	}
	if err := rows.Close(); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Tx.Commit()
}
