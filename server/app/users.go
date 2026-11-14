package app

import (
	"context"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/predicate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
)

// users is edition.Users over the open schema.
type users struct{ db *ent.Client }

// NewUsers is the account table as a closed console reads it.
func NewUsers(db *ent.Client) edition.Users { return users{db} }

func (u users) List(ctx context.Context, q string, page, size int) ([]edition.User, int, error) {
	var where []predicate.User
	if q != "" {
		where = append(where, user.Or(user.EmailContainsFold(q), user.NameContainsFold(q)))
	}
	total, err := u.db.User.Query().Where(where...).Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	rows, err := u.db.User.Query().Where(where...).
		Order(ent.Desc(user.FieldCreatedAt), ent.Desc(user.FieldID)).
		Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return nil, 0, err
	}
	out := make([]edition.User, len(rows))
	for i, r := range rows {
		out[i] = edition.User{ID: r.ID, Name: r.Name, Locale: r.Locale, CreatedAt: r.CreatedAt}
		if r.Email != nil {
			out[i].Email = *r.Email
		}
	}
	return out, total, nil
}

func (u users) Count(ctx context.Context, since time.Time) (int, error) {
	q := u.db.User.Query()
	if !since.IsZero() {
		q = q.Where(user.CreatedAtGTE(since))
	}
	return q.Count(ctx)
}

func (u users) Rename(ctx context.Context, id string, name *string) (bool, error) {
	up := u.db.User.UpdateOneID(id)
	if name == nil {
		up = up.ClearName()
	} else {
		up = up.SetName(*name)
	}
	err := up.Exec(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	return err == nil, err
}

func (u users) InTeam(ctx context.Context, id string) (bool, error) {
	return u.db.Membership.Query().Where(membership.UserID(id)).Exist(ctx)
}
