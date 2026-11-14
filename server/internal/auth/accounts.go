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
// identity index, roll back, and read what the winner wrote.
func Account(ctx context.Context, c *ent.Client, p Proof) (*ent.User, bool, error) {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		var tx *ent.Tx
		if tx, err = c.Tx(ctx); err != nil {
			return nil, false, err
		}
		u, created, err := account(ctx, tx.Client(), p)
		if err == nil {
			if err = tx.Commit(); err == nil {
				return u, created, nil
			}
		} else {
			tx.Rollback()
		}
		if !ent.IsConstraintError(err) {
			return nil, false, err
		}
	}
	return nil, false, err
}

// AccountInTx is Account inside the caller's transaction, whose commit
// decides. A lost race is the caller's constraint error: on Postgres the
// failed write has aborted the transaction, so it cannot read again.
func AccountInTx(ctx context.Context, tx *ent.Tx, p Proof) (*ent.User, bool, error) {
	return account(ctx, tx.Client(), p)
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
		if u, err = c.User.Create().SetNillableEmail(p.Email).SetNillableName(fit(p.Name, 80)).SetNillableImage(fitURL(p.Image, 2048)).Save(ctx); err != nil {
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

// fit cuts a name a provider sent to what the profile holds: a long display
// name must not stop its owner signing in.
func fit(s *string, max int) *string {
	if s == nil {
		return nil
	}
	r := []rune(*s)
	if len(r) <= max {
		return s
	}
	cut := string(r[:max])
	return &cut
}

// fitURL drops an image address too long to keep; a cut one would be broken.
func fitURL(s *string, max int) *string {
	if s == nil || len(*s) > max {
		return nil
	}
	return s
}
