package auth

import (
	"context"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/identity"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
)

// Proof is what a door proved about the person: the provider and the subject
// it vouches for, and an email it verified, if any (ADR 0014).
type Proof struct {
	Provider string  // "email", "google"
	Subject  string  // the lower-cased email for "email"; Google's id
	Email    *string // verified by the door; never an unverified one
	Name     *string
	Image    *string
}

// Account is the account a proof signs in to, and whether it was just made.
// A known identity is its account. Otherwise a verified email joins the
// account that address already has, so Google and an emailed code for one
// address are one account; with neither, a new account is made.
//
// The account and its identity are written in one transaction, so of several
// first sign-ins racing for one proof exactly one commits, and that one is
// the one told it made the account; the others meet the unique email or
// identity index, roll back, and read what the winner wrote. Called inside a
// transaction already, it writes in that one.
func Account(ctx context.Context, c *ent.Client, p Proof) (*ent.User, bool, error) {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		var u *ent.User
		var created bool
		u, created, err = accountOnce(ctx, c, p)
		if err == nil || !ent.IsConstraintError(err) {
			return u, created, err
		}
	}
	return nil, false, err
}

func accountOnce(ctx context.Context, c *ent.Client, p Proof) (*ent.User, bool, error) {
	tx, err := c.Tx(ctx)
	if err != nil {
		// Already in a transaction: the caller's commit decides.
		return account(ctx, c, p)
	}
	u, created, err := account(ctx, tx.Client(), p)
	if err != nil {
		tx.Rollback()
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return u, created, nil
}

func account(ctx context.Context, c *ent.Client, p Proof) (*ent.User, bool, error) {
	found, err := c.Identity.Query().Where(identity.Provider(p.Provider), identity.Subject(p.Subject)).QueryUser().Only(ctx)
	if err == nil || !ent.IsNotFound(err) {
		return found, false, err
	}
	var u *ent.User
	if p.Email != nil {
		u, err = c.User.Query().Where(user.Email(*p.Email)).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return nil, false, err
		}
	}
	created := false
	if u == nil {
		if u, err = c.User.Create().SetNillableEmail(p.Email).SetNillableName(p.Name).SetNillableImage(p.Image).Save(ctx); err != nil {
			return nil, false, err
		}
		created = true
	}
	if err := c.Identity.Create().SetProvider(p.Provider).SetSubject(p.Subject).SetUserID(u.ID).Exec(ctx); err != nil {
		return nil, false, err
	}
	return u, created, nil
}

// EmailProof is what an email door proves: the address itself.
func EmailProof(email string) Proof {
	return Proof{Provider: EmailProvider, Subject: email, Email: &email}
}
