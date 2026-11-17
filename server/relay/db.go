package relay

import (
	"context"
	"errors"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
)

// clientOf is an ent client over the server's own connection.
func clientOf(h edition.Host) *ent.Client {
	return ent.NewClient(ent.Driver(entsql.OpenDB(h.Dialect, h.DB)))
}

// borrowed is an ent client over a transaction the server owns, as a
// Host.SubscribeTeams handler receives it. It cannot start, commit or close
// that transaction: ent's update-and-read builders ask for an internal one,
// and get the caller's, whose Commit and Rollback are no-ops here. An error
// still reaches the owner, which rolls the whole thing back.
func borrowed(dialectName string, tx edition.SQLExecutor) *ent.Client {
	d := &borrowedDriver{Driver: entsql.NewDriver(dialectName, entsql.Conn{ExecQuerier: tx})}
	return ent.NewClient(ent.Driver(d))
}

type borrowedDriver struct{ *entsql.Driver }

func (d *borrowedDriver) Tx(context.Context) (dialect.Tx, error) { return dialect.NopTx(d), nil }
func (d *borrowedDriver) Close() error {
	return errors.New("cannot close a borrowed transaction")
}
