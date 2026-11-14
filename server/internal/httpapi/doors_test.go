package httpapi_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/password"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/verificationcode"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// mailbox is a Mailer that keeps the last code per address, or refuses.
type mailbox struct {
	mu     sync.Mutex
	codes  map[string]string
	refuse bool
}

func (m *mailbox) SendCode(_ context.Context, to, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.refuse {
		return errors.New("550 mailbox unavailable")
	}
	if m.codes == nil {
		m.codes = map[string]string{}
	}
	m.codes[to] = code
	return nil
}

func (m *mailbox) code(to string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.codes[to]
}

// The emailed-code door: a code reaches the address, signs in once and makes
// the account on its owner's first sign-in; the password door is closed.
func TestEmailCodeDoor(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		mail := &mailbox{}
		e := start(t, d, options{smtp: "smtp://mail.example", mailer: mail})
		b := e.browser()
		session := must(t, b.get("/api/auth/session"), 200)
		if doors := session["doors"].(map[string]any); doors["emailCode"] != true || doors["password"] != false {
			t.Fatalf("doors: %v", doors)
		}
		if r := b.post("/api/auth/email/send", map[string]string{"email": "not an address"}); r.code() != "invalid_email" {
			t.Fatalf("bad address: %s", r.body)
		}
		must(t, b.post("/api/auth/email/send", map[string]string{"email": "Ada@Example.com"}), 204)
		code := mail.code("ada@example.com")
		if len(code) != 6 {
			t.Fatalf("no code reached the address: %q", code)
		}
		if r := b.post("/api/auth/email/verify", map[string]string{"email": "ada@example.com", "code": "000000"}); r.code() != "invalid_code" && code != "000000" {
			t.Fatalf("wrong code: %s", r.body)
		}
		must(t, b.post("/api/auth/email/verify", map[string]string{"email": "ada@example.com", "code": code}), 204)
		if user := must(t, b.get("/api/auth/session"), 200)["user"].(map[string]any); user["email"] != "ada@example.com" {
			t.Fatalf("signed in as %v", user)
		}
		if r := e.browser().post("/api/auth/email/verify", map[string]string{"email": "ada@example.com", "code": code}); r.code() != "invalid_code" {
			t.Fatalf("a code used twice: %s", r.body)
		}
		if r := e.browser().post("/api/auth/password/sign-in", map[string]string{"email": "ada@example.com", "password": "anything at all"}); r.code() != "not_allowed" {
			t.Fatalf("password door on an email instance: %s", r.body)
		}
	})
}

// A code that could not be sent is given back: failed sends do not use up the
// address's five, and leave no code that could sign in.
func TestUnsentCodeIsGivenBack(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		mail := &mailbox{refuse: true}
		e := start(t, d, options{smtp: "smtp://mail.example", mailer: mail})
		for i := 0; i < auth.MaxCodesSent+2; i++ {
			if r := e.browser().post("/api/auth/email/send", map[string]string{"email": "ada@example.com"}); r.code() != "unavailable" {
				t.Fatalf("send %d while SMTP refuses: %d %s", i+1, r.status, r.body)
			}
		}
		if n := d.Client.VerificationCode.Query().Where(verificationcode.Email("ada@example.com")).CountX(context.Background()); n != 0 {
			t.Fatalf("%d unsent codes kept", n)
		}
		mail.mu.Lock()
		mail.refuse = false
		mail.mu.Unlock()
		must(t, e.browser().post("/api/auth/email/send", map[string]string{"email": "ada@example.com"}), 204)
	})
}

// An admin adding an address that already has an account adds it as it is:
// an account with no password (made through Google) does not get one the
// admin would know, which would hand the admin that account and its place in
// every other team.
func TestAddingAnAccountWithoutAPasswordGivesItNone(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := must(t, admin.post("/api/teams", map[string]string{"name": "B"}), 201)["id"].(string)
		email := "alice@x.io"
		alice, _, err := auth.Account(ctx, d.Client, auth.Proof{Provider: "google", Subject: "g-alice", Email: &email})
		if err != nil {
			t.Fatal(err)
		}
		added := must(t, admin.post("/api/teams/"+teamID+"/members", map[string]string{"email": email}), 201)
		if added["password"] != nil || added["userId"] != alice.ID {
			t.Fatalf("added: %v", added)
		}
		if has := d.Client.Password.Query().Where(password.UserID(alice.ID)).ExistX(ctx); has {
			t.Fatal("an admin set a password on an account that had none")
		}
	})
}

// Two admins adding one new address at once: one adds it, the other is told
// it is already a member, never a server error.
func TestAddingOneAddressTwiceAtOnce(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := must(t, admin.post("/api/teams", map[string]string{"name": "T"}), 201)["id"].(string)
		for round := 0; round < 5; round++ {
			email := fmt.Sprintf("new%d@x.io", round)
			statuses := make([]response, 2)
			var wg sync.WaitGroup
			for i := range statuses {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					statuses[i] = admin.post("/api/teams/"+teamID+"/members", map[string]string{"email": email})
				}(i)
			}
			wg.Wait()
			created := 0
			for _, r := range statuses {
				switch {
				case r.status == http.StatusCreated:
					created++
				case r.status == http.StatusConflict && r.code() == "member_in_team":
				default:
					t.Fatalf("round %d: %d %s", round, r.status, r.body)
				}
			}
			if created != 1 {
				t.Fatalf("round %d: %d added", round, created)
			}
		}
	})
}

// A configuration keeps its kind: a model a preset references cannot become
// a plugin.
func TestConfigKindDoesNotChange(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		admin := e.admin("a@x.io")
		teamID, modelID := e.team(admin, newStub(t), "T")
		r := do(t, admin.client, "PATCH", e.url+"/api/teams/"+teamID+"/configs/"+modelID,
			map[string]any{"kind": "plugin", "name": "Stub", "data": map[string]any{"package": "x", "version": "1.0.0"}, "version": 1},
			map[string]string{"Origin": admin.origin})
		if r.status != 400 || r.code() != "invalid_request" {
			t.Fatalf("kind change: %d %s", r.status, r.body)
		}
	})
}

// Limits count characters, not bytes: a Chinese team name of 100 characters
// and a Chinese profile name of 80 are kept, one more is refused, and none
// is a server error.
func TestNamesCountCharacters(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("a@x.io")
		long := strings.Repeat("团", 100)
		if got := must(t, admin.post("/api/teams", map[string]string{"name": long}), 201)["name"]; got != long {
			t.Fatalf("name kept as %v", got)
		}
		if r := admin.post("/api/teams", map[string]string{"name": long + "团"}); r.status != 400 {
			t.Fatalf("101 characters: %d %s", r.status, r.body)
		}
		name := strings.Repeat("名", 80)
		r := do(t, admin.client, "PATCH", e.url+"/api/profile", map[string]any{"name": name}, map[string]string{"Origin": admin.origin})
		if r.status != 200 || r.json(t)["name"] != name {
			t.Fatalf("80-character name: %d %s", r.status, r.body)
		}
	})
}
