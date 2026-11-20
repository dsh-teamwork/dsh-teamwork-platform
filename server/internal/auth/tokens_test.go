package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

var verifier = strings.Repeat("v", 50)

// handoff is a signed-in user's hand-off code, minted through Google.
func handoff(t *testing.T, s *auth.Service, d *testdb.DB) (userID, code string) {
	t.Helper()
	ctx := context.Background()
	u, err := ensureUser(ctx, d.Client, "a@example.test")
	if err != nil {
		t.Fatal(err)
	}
	code, err = s.MintHandoff(ctx, u, "google", auth.ChallengeOf(verifier))
	if err != nil {
		t.Fatal(err)
	}
	return u.ID, code
}

// The token names the same user, and carries the door the web session came
// through into the plugin.
func TestHandoffTradesForBearer(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		userID, code := handoff(t, s, d)
		if _, _, err := s.RedeemHandoff(ctx, code, verifier+"x"); !errors.Is(err, auth.ErrInvalidCode) {
			t.Fatalf("another verifier: %v", err)
		}
		token, _, err := s.RedeemHandoff(ctx, code, verifier)
		if err != nil {
			t.Fatal(err)
		}
		c, _, err := s.OpenBearer(ctx, token)
		if err != nil || c.Sub != userID || c.Via != "google" || c.Grant == "" {
			t.Fatalf("bearer claims %+v, %v; want sub %s via google with a grant", c, err, userID)
		}
	})
}

// A token lapses a GrantIdle after its last use, not after its sign-in, so a
// DSH in daily use never has to sign in again — up to GrantMaxTTL (ADR 0060).
func TestBearerLapsesOnlyWhenUnused(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		c := newClock()
		s := newService(d, c)
		userID, code := handoff(t, s, d)
		token, lapses, err := s.RedeemHandoff(ctx, code, verifier)
		if err != nil || !lapses.Equal(c.Now().Add(auth.GrantIdle)) {
			t.Fatalf("lapses %v, %v", lapses, err)
		}
		for range 3 {
			c.Advance(auth.GrantIdle - time.Second)
			if _, lapses, err = s.OpenBearer(ctx, token); err != nil || !lapses.Equal(c.Now().Add(auth.GrantIdle)) {
				t.Fatalf("a token in use lapsed: %v, %v", lapses, err)
			}
		}
		c.Advance(auth.GrantIdle)
		if _, _, err := s.OpenBearer(ctx, token); !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("a token unused for GrantIdle opened: %v", err)
		}

		// However often it is used, no token outlives GrantMaxTTL.
		token, _, err = s.IssueBearer(ctx, userID, "google")
		if err != nil {
			t.Fatal(err)
		}
		for used := time.Duration(0); used+auth.GrantIdle/2 < auth.GrantMaxTTL; used += auth.GrantIdle / 2 {
			c.Advance(auth.GrantIdle / 2)
			if _, _, err := s.OpenBearer(ctx, token); err != nil {
				t.Fatalf("lapsed after %v: %v", used, err)
			}
		}
		c.Advance(auth.GrantIdle / 2)
		if _, _, err := s.OpenBearer(ctx, token); !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("a token opened past GrantMaxTTL: %v", err)
		}
	})
}

// Revoking a token closes it at once, and only it: the same account's other
// DSHs stay signed in.
func TestRevokedBearerDoesNotOpen(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		userID, _ := handoff(t, s, d)
		one, _, err := s.IssueBearer(ctx, userID, "google")
		if err != nil {
			t.Fatal(err)
		}
		other, _, err := s.IssueBearer(ctx, userID, "google")
		if err != nil {
			t.Fatal(err)
		}
		if err := s.RevokeBearer(ctx, one); err != nil {
			t.Fatal(err)
		}
		if _, _, err := s.OpenBearer(ctx, one); !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("a revoked token opened: %v", err)
		}
		if _, _, err := s.OpenBearer(ctx, other); err != nil {
			t.Fatalf("revoking one token closed another: %v", err)
		}
		if err := s.RevokeBearer(ctx, one); err != nil {
			t.Fatalf("revoking twice: %v", err)
		}
	})
}

// A token sealed without a grant — every token from before ADR 0060 — opens
// nothing, however long its seal has left.
func TestBearerWithoutGrantDoesNotOpen(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		s := newService(d, newClock())
		userID, _ := handoff(t, s, d)
		token, _, err := s.Sealer.Seal(auth.PluginBearer, auth.Claims{Sub: userID, Via: "google"}, auth.GrantIdle)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := s.OpenBearer(context.Background(), token); !errors.Is(err, auth.ErrInvalidToken) {
			t.Fatalf("a token without a grant opened: %v", err)
		}
	})
}

func TestCodeAndBearerAreNotInterchangeable(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		_, code := handoff(t, s, d)
		if _, err := s.Sealer.Open(auth.PluginBearer, code); err == nil {
			t.Fatal("a hand-off code opened as a Bearer token")
		}
		token, _, err := s.RedeemHandoff(ctx, code, verifier)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.Sealer.Open(auth.PluginHandoff, token); err == nil {
			t.Fatal("a Bearer token opened as a hand-off code")
		}
		if _, _, err := s.RedeemHandoff(ctx, token, verifier); !errors.Is(err, auth.ErrInvalidCode) {
			t.Fatalf("a Bearer token redeemed as a code: %v", err)
		}
	})
}

func TestSealedUnderAnotherSecretDoesNotOpen(t *testing.T) {
	token, _, err := auth.NewSealer(strings.Repeat("o", 40), nil).Seal(auth.PluginBearer, auth.Claims{Sub: "u1"}, auth.SessionTTL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.NewSealer(testSecret, nil).Open(auth.PluginBearer, token); err == nil {
		t.Fatal("a token sealed under another secret opened")
	}
}

func TestExpiredDoesNotOpen(t *testing.T) {
	c := newClock()
	s := auth.NewSealer(testSecret, c.Now)
	token, exp, err := s.Seal(auth.PluginBearer, auth.Claims{Sub: "u1"}, auth.SessionTTL)
	if err != nil {
		t.Fatal(err)
	}
	if !exp.Equal(c.Now().Add(auth.SessionTTL)) {
		t.Fatalf("expiry %v", exp)
	}
	c.Advance(auth.SessionTTL - time.Second)
	if _, err := s.Open(auth.PluginBearer, token); err != nil {
		t.Fatalf("opened a second before expiry: %v", err)
	}
	c.Advance(time.Second)
	if _, err := s.Open(auth.PluginBearer, token); err == nil {
		t.Fatal("an expired token opened")
	}
}

func TestExpiredHandoffDoesNotRedeem(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		c := newClock()
		s := newService(d, c)
		_, code := handoff(t, s, d)
		c.Advance(auth.HandoffTTL)
		if _, _, err := s.RedeemHandoff(context.Background(), code, verifier); !errors.Is(err, auth.ErrInvalidCode) {
			t.Fatalf("an expired code redeemed: %v", err)
		}
	})
}
