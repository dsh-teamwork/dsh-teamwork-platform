package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/ratewindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/verificationcode"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Email sign-in codes, where the instance sends email (SMTP_URL). Only a
// keyed hash is stored, so reading the table mints nothing. A code lives ten
// minutes and is checked at most five times; an address is sent at most five
// codes in fifteen minutes. Those three numbers are the whole brute-force
// defence: six digits is a million guesses, and five per code keeps that out
// of reach.
const (
	CodeTTL         = 10 * time.Minute
	MaxCodeChecks   = 5
	MaxCodesSent    = 5
	CodeSendsWindow = 15 * time.Minute
)

func (s *Service) codeHash(email, code string) string {
	m := hmac.New(sha256.New, []byte(s.Secret))
	fmt.Fprintf(m, "%s\n%s", email, code)
	return hex.EncodeToString(m.Sum(nil))
}

// IssueCode is a new code for an address, or too_many_attempts. The count is
// the address's window in rate_windows, claimed by a conditional update, so a
// burst of sends for one address cannot all see "under the limit".
func (s *Service) IssueCode(ctx context.Context, email string) (string, error) {
	key, now := "code:"+email, s.now()
	if err := s.DB.RateWindow.Create().SetKey(key).SetWindowStart(now).SetCount(0).
		OnConflictColumns(ratewindow.FieldKey).Ignore().Exec(ctx); err != nil {
		return "", err
	}
	fresh, err := s.DB.RateWindow.Update().Where(ratewindow.Key(key), ratewindow.WindowStartLTE(now.Add(-CodeSendsWindow))).
		SetCount(1).SetWindowStart(now).Save(ctx)
	if err != nil {
		return "", err
	}
	if fresh == 0 {
		counted, err := s.DB.RateWindow.Update().Where(ratewindow.Key(key), ratewindow.CountLT(MaxCodesSent)).AddCount(1).Save(ctx)
		if err != nil {
			return "", err
		}
		if counted == 0 {
			return "", refuse(wire.TooManyAttempts)
		}
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	err = s.DB.VerificationCode.Create().SetEmail(email).SetCodeHash(s.codeHash(email, code)).
		SetExpiresAt(now.Add(CodeTTL)).SetCreatedAt(now).Exec(ctx)
	return code, err
}

// ConsumeCode checks a code against the newest one sent to the address. The
// check is spent before the comparison: one conditional update, and only a
// guess that won it is compared, so a burst gets at most five comparisons
// between them. A match consumes every code for the address, and of two
// concurrent right guesses only the one whose delete took the row signs in.
func (s *Service) ConsumeCode(ctx context.Context, email, code string) error {
	now := s.now()
	latest, err := s.DB.VerificationCode.Query().Where(verificationcode.Email(email)).
		Order(ent.Desc(verificationcode.FieldCreatedAt), ent.Desc(verificationcode.FieldID)).First(ctx)
	if ent.IsNotFound(err) {
		return refuse(wire.InvalidCode)
	}
	if err != nil {
		return err
	}
	if !latest.ExpiresAt.After(now) {
		return refuse(wire.CodeExpired)
	}
	claimed, err := s.DB.VerificationCode.Update().
		Where(verificationcode.ID(latest.ID), verificationcode.AttemptsLT(MaxCodeChecks)).AddAttempts(1).Save(ctx)
	if err != nil {
		return err
	}
	if claimed == 0 {
		return refuse(wire.TooManyAttempts)
	}
	if !hmac.Equal([]byte(latest.CodeHash), []byte(s.codeHash(email, code))) {
		return refuse(wire.InvalidCode)
	}
	consumed, err := s.DB.VerificationCode.Delete().Where(verificationcode.ID(latest.ID)).Exec(ctx)
	if err != nil {
		return err
	}
	if consumed == 0 {
		return refuse(wire.InvalidCode)
	}
	_, err = s.DB.VerificationCode.Delete().Where(verificationcode.Email(email)).Exec(ctx)
	return err
}

// ReturnCode undoes IssueCode for a code that could not be sent: the code is
// deleted, and the send it spent is given back to the address's window.
func (s *Service) ReturnCode(ctx context.Context, email, code string) error {
	if _, err := s.DB.VerificationCode.Delete().
		Where(verificationcode.Email(email), verificationcode.CodeHash(s.codeHash(email, code))).Exec(ctx); err != nil {
		return err
	}
	_, err := s.DB.RateWindow.Update().Where(ratewindow.Key("code:"+email), ratewindow.CountGT(0)).AddCount(-1).Save(ctx)
	return err
}
