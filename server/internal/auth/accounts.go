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
// address are one account; with neither, a new account is made. Two first
// sign-ins racing for one address meet on the unique email and identity
// indexes, and the loser reads what the winner wrote.
func Account(ctx context.Context, c *ent.Client, p Proof) (*ent.User, bool, error) {
	u, created, err := account(ctx, c, p)
	if err != nil && ent.IsConstraintError(err) {
		u, created, err = account(ctx, c, p)
	}
	return u, created, err
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
