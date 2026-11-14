package auth_test

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func TestHashPasswordFormat(t *testing.T) {
	hash, err := auth.HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$`).MatchString(hash) {
		t.Fatalf("hash %q is not scrypt$N$r$p$salt$key", hash)
	}
	if strings.Contains(hash, "correct horse") {
		t.Fatal("the hash holds the password")
	}
	if !auth.VerifyPassword(hash, "correct horse battery") {
		t.Fatal("the right password does not verify")
	}
	if auth.VerifyPassword(hash, "correct horse battery!") {
		t.Fatal("a wrong password verifies")
	}
}

// A wrong password and an unknown address answer the same, so the answer
// says nothing about which accounts exist.
func TestCheckPasswordAnswers(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		u, err := auth.EnsureEmailUser(ctx, d.Client, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetPassword(ctx, u.ID, "correct horse battery", false); err != nil {
			t.Fatal(err)
		}
		got, err := s.CheckPassword(ctx, "A@Example.test", "correct horse battery")
		if err != nil || got.ID != u.ID {
			t.Fatalf("right password: %v %v", got, err)
		}
		_, err = s.CheckPassword(ctx, "a@example.test", "wrong password!")
		if r := refusal(t, err); r != wire.InvalidCredentials {
			t.Fatalf("wrong password: %q", r)
		}
		_, err = s.CheckPassword(ctx, "nobody@example.test", "correct horse battery")
		if r := refusal(t, err); r != wire.InvalidCredentials {
			t.Fatalf("unknown address: %q", r)
		}
	})
}

func TestSetPasswordClearsGuessesAndCarriesMustChange(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := newService(d, newClock())
		u, err := auth.EnsureEmailUser(ctx, d.Client, "a@example.test")
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetPassword(ctx, u.ID, "correct horse battery", false); err != nil {
			t.Fatal(err)
		}
		for range auth.MaxFailures {
			if _, err := s.CheckPassword(ctx, "a@example.test", "wrong password!"); refusal(t, err) != wire.InvalidCredentials {
				t.Fatalf("wrong guess: %v", err)
			}
		}
		if _, err := s.CheckPassword(ctx, "a@example.test", "correct horse battery"); refusal(t, err) != wire.TooManyAttempts {
			t.Fatalf("after the limit: %v", err)
		}

		if err := s.SetPassword(ctx, u.ID, "a first password", true); err != nil {
			t.Fatal(err)
		}
		if must, err := s.MustChange(ctx, u.ID); err != nil || !must {
			t.Fatalf("must-change mark: %v %v", must, err)
		}
		if got, err := s.CheckPassword(ctx, "a@example.test", "a first password"); err != nil || got.ID != u.ID {
			t.Fatalf("new password after set: %v %v", got, err)
		}
		if _, err := s.CheckPassword(ctx, "a@example.test", "correct horse battery"); refusal(t, err) != wire.InvalidCredentials {
			t.Fatalf("old password after set: %v", err)
		}
	})
}

func TestGeneratePassword(t *testing.T) {
	first := auth.GeneratePassword()
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{20,}$`).MatchString(first) {
		t.Fatalf("%q is not at least 20 characters of base64url", first)
	}
	if auth.GeneratePassword() == first {
		t.Fatal("two first passwords are the same")
	}
}
