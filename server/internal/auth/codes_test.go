package auth_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/verificationcode"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

const testSecret = "test-secret-at-least-thirty-two-characters-long"

// clock is a settable time for expiry tests.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *clock { return &clock{t: time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)} }

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newService(d *testdb.DB, c *clock) *auth.Service {
	return &auth.Service{DB: d.Client, Sealer: auth.NewSealer(testSecret, c.Now), Secret: testSecret, Now: c.Now}
}

// refusal is the auth code err names, or fails the test on any other error.
func refusal(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	var r *auth.Refusal
	if !errors.As(err, &r) {
		t.Fatalf("not a refusal: %v", err)
	}
	return r.Code
}

func wrongCode(code string) string {
	if code == "000000" {
		return "111111"
	}
	return "000000"
}

func TestCodeNeverStored(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		code, err := s.IssueCode(ctx, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		row, err := d.Client.VerificationCode.Query().Where(verificationcode.Email("a@example.test")).Only(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(row.CodeHash, code) {
			t.Fatalf("code_hash %q holds the code %q", row.CodeHash, code)
		}
	})
}

func TestCodeAcceptedOnce(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		code, err := s.IssueCode(ctx, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		if got := refusal(t, s.ConsumeCode(ctx, "a@example.test", code)); got != "" {
			t.Fatalf("first use refused: %s", got)
		}
		if got := refusal(t, s.ConsumeCode(ctx, "a@example.test", code)); got != wire.InvalidCode {
			t.Fatalf("second use: %q, want %s", got, wire.InvalidCode)
		}
	})
}

func TestCodeStopsAfterTooManyGuesses(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		code, err := s.IssueCode(ctx, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < auth.MaxCodeChecks; i++ {
			if got := refusal(t, s.ConsumeCode(ctx, "a@example.test", wrongCode(code))); got != wire.InvalidCode {
				t.Fatalf("wrong guess %d: %q", i, got)
			}
		}
		if got := refusal(t, s.ConsumeCode(ctx, "a@example.test", code)); got != wire.TooManyAttempts {
			t.Fatalf("right code after the limit: %q, want %s", got, wire.TooManyAttempts)
		}
	})
}

func TestCodeExpires(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		c := newClock()
		s := newService(d, c)
		code, err := s.IssueCode(ctx, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		c.Advance(auth.CodeTTL)
		if got := refusal(t, s.ConsumeCode(ctx, "a@example.test", code)); got != wire.CodeExpired {
			t.Fatalf("after CodeTTL: %q, want %s", got, wire.CodeExpired)
		}
	})
}

func TestCodeSendsRateLimited(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		c := newClock()
		s := newService(d, c)
		for i := 0; i < auth.MaxCodesSent; i++ {
			if _, err := s.IssueCode(ctx, "a@example.test"); err != nil {
				t.Fatalf("send %d: %v", i, err)
			}
		}
		_, err := s.IssueCode(ctx, "a@example.test")
		if got := refusal(t, err); got != wire.TooManyAttempts {
			t.Fatalf("send over the limit: %q, want %s", got, wire.TooManyAttempts)
		}
		if _, err := s.IssueCode(ctx, "b@example.test"); err != nil {
			t.Fatalf("another address shares the limit: %v", err)
		}
		c.Advance(auth.CodeSendsWindow)
		if _, err := s.IssueCode(ctx, "a@example.test"); err != nil {
			t.Fatalf("send in a new window: %v", err)
		}
	})
}

// A guess is spent before the comparison, so a concurrent burst gets exactly
// MaxCodeChecks comparisons between them.
func TestCodeGuessBurst(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		code, err := s.IssueCode(ctx, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		const burst = 30
		results := make([]error, burst)
		var wg sync.WaitGroup
		for i := range burst {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results[i] = s.ConsumeCode(ctx, "a@example.test", wrongCode(code))
			}()
		}
		wg.Wait()
		counts := map[string]int{}
		for _, err := range results {
			counts[refusal(t, err)]++
		}
		if counts[wire.InvalidCode] != auth.MaxCodeChecks || counts[wire.TooManyAttempts] != burst-auth.MaxCodeChecks {
			t.Fatalf("burst outcomes %v, want %d compared", counts, auth.MaxCodeChecks)
		}
		if got := refusal(t, s.ConsumeCode(ctx, "a@example.test", code)); got != wire.TooManyAttempts {
			t.Fatalf("right code after the burst: %q", got)
		}
	})
}

func TestCodeSendBurst(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		const burst = 30
		results := make([]error, burst)
		var wg sync.WaitGroup
		for i := range burst {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, results[i] = s.IssueCode(ctx, "a@example.test")
			}()
		}
		wg.Wait()
		counts := map[string]int{}
		for _, err := range results {
			counts[refusal(t, err)]++
		}
		if counts[""] != auth.MaxCodesSent || counts[wire.TooManyAttempts] != burst-auth.MaxCodesSent {
			t.Fatalf("burst outcomes %v, want %d sent", counts, auth.MaxCodesSent)
		}
		n, err := d.Client.VerificationCode.Query().Where(verificationcode.Email("a@example.test")).Count(ctx)
		if err != nil || n != auth.MaxCodesSent {
			t.Fatalf("stored codes: %d %v", n, err)
		}
	})
}

// ensureUser is the account an address proves, made when it has none.
func ensureUser(ctx context.Context, c *ent.Client, email string) (*ent.User, error) {
	u, _, err := auth.Account(ctx, c, auth.EmailProof(email))
	return u, err
}
