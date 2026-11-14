// Package auth signs people in and says who a request is from: a browser's
// session cookie or the DSH plugin's Bearer token, both sealed under
// AUTH_SECRET. It stores and checks; who may set whose password is the team's
// rule (internal/team).
//
// Phase 1 of docs/tech/go-server.md: passwords, the first account's setup
// link, and the plugin's PKCE hand-off (docs/adr/0001-plugin-sign-in.md).
package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/password"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/ratewindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Guesses: ten passwords per address per fifteen minutes, each spent before
// the comparison, so a burst of concurrent guesses gets no more.
const (
	MaxFailures   = 10
	FailureWindow = 15 * time.Minute
)

// EmailProvider is the identity both email doors prove: the lower-cased
// address. An emailed code and a password for one address are one account.
const EmailProvider = "email"

// Service is sign-in over one database.
type Service struct {
	DB     *ent.Client
	Sealer *Sealer
	Secret string
	Now    func() time.Time

	decoyOnce sync.Once
	decoy     string
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Refusal is a sign-in that did not work, named by a wire.* auth code.
type Refusal struct{ Code string }

func (r *Refusal) Error() string { return r.Code }

func refuse(code string) error { return &Refusal{Code: code} }

// UserByEmail is the account an address signs in to through an email door,
// with its password, or nil.
func (s *Service) UserByEmail(ctx context.Context, email string) (*ent.User, error) {
	u, err := s.DB.User.Query().Where(user.Email(wire.NormalizeEmail(email))).WithPassword().Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return u, err
}

// CheckPassword is the account an email and password sign in to. A guess is
// spent before the comparison, against the address whether or not it has an
// account, so the limit says nothing about which accounts exist.
func (s *Service) CheckPassword(ctx context.Context, email, pw string) (*ent.User, error) {
	email = wire.NormalizeEmail(email)
	ok, err := s.claimGuess(ctx, email)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, refuse(wire.TooManyAttempts)
	}
	user, err := s.UserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Edges.Password == nil {
		// An unknown address costs what a known one does.
		s.decoyOnce.Do(func() { s.decoy, _ = HashPassword(GeneratePassword()) })
		VerifyPassword(s.decoy, pw)
		return nil, refuse(wire.InvalidCredentials)
	}
	if !VerifyPassword(user.Edges.Password.Hash, pw) {
		return nil, refuse(wire.InvalidCredentials)
	}
	return user, s.clearGuesses(ctx, email)
}

func guessKey(email string) string { return "password:" + email }

// claimGuess spends one of the address's guesses, or answers that they are
// used up: open a new window if the last one has passed, otherwise count into
// it while under the limit. Each is one conditional update, atomic on every
// dialect.
func (s *Service) claimGuess(ctx context.Context, email string) (bool, error) {
	key, now := guessKey(email), s.now()
	if err := s.DB.RateWindow.Create().SetKey(key).SetWindowStart(now).SetCount(0).
		OnConflictColumns(ratewindow.FieldKey).Ignore().Exec(ctx); err != nil {
		return false, err
	}
	fresh, err := s.DB.RateWindow.Update().
		Where(ratewindow.Key(key), ratewindow.WindowStartLTE(now.Add(-FailureWindow))).
		SetCount(1).SetWindowStart(now).Save(ctx)
	if err != nil || fresh > 0 {
		return fresh > 0, err
	}
	counted, err := s.DB.RateWindow.Update().
		Where(ratewindow.Key(key), ratewindow.CountLT(MaxFailures)).
		AddCount(1).Save(ctx)
	return counted > 0, err
}

func (s *Service) clearGuesses(ctx context.Context, email string) error {
	_, err := s.DB.RateWindow.Delete().Where(ratewindow.Key(guessKey(email))).Exec(ctx)
	return err
}

// SetPassword sets or replaces a user's password and clears the guesses
// counted against their address.
func (s *Service) SetPassword(ctx context.Context, userID, pw string, mustChange bool) error {
	hash, err := HashPassword(pw)
	if err != nil {
		return err
	}
	err = s.DB.Password.Create().SetUserID(userID).SetHash(hash).SetMustChange(mustChange).
		OnConflictColumns(password.FieldUserID).
		Update(func(u *ent.PasswordUpsert) { u.SetHash(hash).SetMustChange(mustChange).UpdateUpdatedAt() }).
		Exec(ctx)
	if err != nil {
		return err
	}
	u, err := s.DB.User.Get(ctx, userID)
	if err != nil || u.Email == nil {
		return err
	}
	return s.clearGuesses(ctx, *u.Email)
}

// ChangePassword replaces the signed-in person's password, checking the
// current one first, which counts as a guess. It clears an admin's
// must-change mark.
func (s *Service) ChangePassword(ctx context.Context, user *ent.User, current, next string) error {
	if !wire.ValidPassword(next) {
		return refuse(wire.WeakPassword)
	}
	if user.Email == nil {
		return refuse(wire.NotAllowed)
	}
	checked, err := s.CheckPassword(ctx, *user.Email, current)
	if err != nil {
		return err
	}
	if checked.ID != user.ID {
		return refuse(wire.InvalidCredentials)
	}
	return s.SetPassword(ctx, user.ID, next, false)
}

// SetupOpen is whether the first account is still to be claimed.
func (s *Service) SetupOpen(ctx context.Context) (bool, error) {
	claimed, err := s.DB.RateWindow.Query().Where(ratewindow.Key(firstAccountKey)).Exist(ctx)
	if err != nil || claimed {
		return false, err
	}
	n, err := s.DB.Password.Query().Count(ctx)
	return n == 0, err
}

const firstAccountKey = "setup:first-account"

// ClaimFirstAccount creates the instance's first account with the token the
// server printed. The claim is a unique row written in the same transaction
// as the account, so two people racing for the link get one account between
// them, on every dialect, and the link is dead once used.
func (s *Service) ClaimFirstAccount(ctx context.Context, token, email, pw string) (*ent.User, error) {
	want := SetupToken(s.Secret)
	if subtle.ConstantTimeCompare([]byte(token), []byte(want)) != 1 {
		return nil, refuse(wire.SetupClosed)
	}
	addr, ok := wire.Email(email)
	if !ok {
		return nil, refuse(wire.InvalidEmail)
	}
	if !wire.ValidPassword(pw) {
		return nil, refuse(wire.WeakPassword)
	}
	hash, err := HashPassword(pw)
	if err != nil {
		return nil, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := tx.RateWindow.Create().SetKey(firstAccountKey).SetWindowStart(s.now()).SetCount(1).Exec(ctx); err != nil {
		if ent.IsConstraintError(err) {
			return nil, refuse(wire.SetupClosed)
		}
		return nil, err
	}
	if n, err := tx.Password.Query().Count(ctx); err != nil || n > 0 {
		if err == nil {
			err = refuse(wire.SetupClosed)
		}
		return nil, err
	}
	user, err := EnsureEmailUser(ctx, tx.Client(), addr)
	if err != nil {
		return nil, err
	}
	if err := tx.Password.Create().SetUserID(user.ID).SetHash(hash).Exec(ctx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		if ent.IsConstraintError(err) {
			return nil, refuse(wire.SetupClosed)
		}
		return nil, err
	}
	return user, nil
}

// EnsureEmailUser is the account an address proves, made when it has none.
func EnsureEmailUser(ctx context.Context, c *ent.Client, email string) (*ent.User, error) {
	u, _, err := Account(ctx, c, EmailProof(email))
	return u, err
}

// MustChange is whether an admin-set password is still unchanged.
func (s *Service) MustChange(ctx context.Context, userID string) (bool, error) {
	p, err := s.DB.Password.Query().Where(password.UserID(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return p.MustChange, nil
}

// ChallengeOf is RFC 7636 S256: base64url(sha256(verifier)).
func ChallengeOf(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// MintHandoff is a two-minute code for the user, bound to the plugin's
// challenge. Not while an admin-set password is unchanged: its owner has not
// yet proved they hold it alone.
func (s *Service) MintHandoff(ctx context.Context, user *ent.User, via, challenge string) (string, error) {
	if !wire.PluginChallenge.MatchString(challenge) {
		return "", refuse(wire.InvalidCode)
	}
	must, err := s.MustChange(ctx, user.ID)
	if err != nil {
		return "", err
	}
	if must {
		return "", refuse(wire.PasswordChangeRequired)
	}
	code, _, err := s.Sealer.Seal(PluginHandoff, Claims{Sub: user.ID, Via: via, Challenge: challenge}, HandoffTTL)
	return code, err
}

// ErrInvalidCode is a hand-off code that is wrong, expired, or not bound to
// the verifier given.
var ErrInvalidCode = errors.New("invalid_code")

// RedeemHandoff trades a code and the verifier it was bound to for a Bearer
// token.
func (s *Service) RedeemHandoff(ctx context.Context, code, verifier string) (string, time.Time, error) {
	c, err := s.Sealer.Open(PluginHandoff, code)
	if err != nil || !wire.ValidVerifier(verifier) ||
		subtle.ConstantTimeCompare([]byte(c.Challenge), []byte(ChallengeOf(verifier))) != 1 {
		return "", time.Time{}, ErrInvalidCode
	}
	if exists, err := s.DB.User.Query().Where(user.ID(c.Sub)).Exist(ctx); err != nil || !exists {
		return "", time.Time{}, ErrInvalidCode
	}
	return s.Sealer.Seal(PluginBearer, Claims{Sub: c.Sub, Via: c.Via}, SessionTTL)
}
