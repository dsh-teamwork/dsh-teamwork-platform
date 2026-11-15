package usage

import (
	"context"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func notificationFixture(t *testing.T, d *testdb.DB, scope string) (*Service, Call, string, *time.Time) {
	t.Helper()
	ctx := context.Background()
	team := d.Client.Team.Create().SetName("Notification team").SaveX(ctx)
	admin := d.Client.User.Create().SetEmail("admin@notice.test").SetLocale("en").SaveX(ctx)
	member := d.Client.User.Create().SetEmail("member@notice.test").SetLocale("zh-CN").SaveX(ctx)
	d.Client.Membership.Create().SetTeamID(team.ID).SetUserID(admin.ID).SetRole("admin").ExecX(ctx)
	d.Client.Membership.Create().SetTeamID(team.ID).SetUserID(member.ID).SetRole("member").ExecX(ctx)
	now := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
	s := &Service{DB: d.Client, AppURL: "https://members.example", Now: func() time.Time { return now }}
	call := referenceCall(member.ID, 80, 20)
	call.TeamID = team.ID
	if _, err := s.SetRate(ctx, call, RateInput{Basis: "cost", Input: "1000", CacheRead: "1000", CacheWrite: "0", Output: "1000"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetPolicy(ctx, team.ID, admin.ID, testPolicy(scope, "", "100")); err != nil {
		t.Fatal(err)
	}
	return s, call, admin.ID, &now
}

func completeNoticeCall(t *testing.T, s *Service, call Call, bound, actual Tokens) {
	t.Helper()
	call.Bounds = func() (Tokens, error) { return bound, nil }
	r, err := s.Begin(context.Background(), call)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(context.Background(), r, Observation{Known: true, Complete: true, Tokens: actual}, ""); err != nil {
		t.Fatal(err)
	}
}

func TestQueuedNoticeIsSuppressedAfterTheCapIsRaised(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s, call, admin, _ := notificationFixture(t, d, "team")
		completeNoticeCall(t, s, call, Tokens{Input: 80, Output: 20}, Tokens{Input: 80})
		policy := testPolicy("team", "", "1000")
		policy.Revision = 1
		if _, err := s.SetPolicy(ctx, call.TeamID, admin, policy); err != nil {
			t.Fatal(err)
		}
		s.SendNotice = func(context.Context, NoticeMessage) error { t.Error("obsolete budget warning was sent"); return nil }
		if err := s.DeliverNotices(ctx); err != nil {
			t.Fatal(err)
		}
		row := d.Client.BudgetNotice.Query().OnlyX(ctx)
		if row.State != budgetnotice.StateSkipped {
			t.Fatalf("obsolete notice state=%s", row.State)
		}
	})
}

func TestNotificationsDeduplicateAndUseTheOriginatingMemberSite(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s, call, _, _ := notificationFixture(t, d, "default_member")
		var mu sync.Mutex
		messages := []NoticeMessage{}
		send := func(ctx context.Context, message NoticeMessage) error {
			mu.Lock()
			defer mu.Unlock()
			messages = append(messages, message)
			return nil
		}
		s.SendNotice = send
		completeNoticeCall(t, s, call, Tokens{Input: 80, Output: 20}, Tokens{Input: 80})
		if err := s.DeliverNotices(ctx); err != nil {
			t.Fatal(err)
		}
		if len(messages) != 2 {
			t.Fatalf("initial notices = %d", len(messages))
		}
		completeNoticeCall(t, s, call, Tokens{Input: 10, Output: 5}, Tokens{Input: 10, Output: 5})
		completeNoticeCall(t, s, call, Tokens{Input: 4, Output: 1}, Tokens{Input: 4, Output: 1})
		other := &Service{DB: d.Client, AppURL: "https://operators.example", Now: s.Now, SendNotice: send}
		var wg sync.WaitGroup
		for _, worker := range []*Service{s, other} {
			wg.Add(1)
			go func(worker *Service) {
				defer wg.Done()
				if err := worker.DeliverNotices(ctx); err != nil {
					t.Error(err)
				}
			}(worker)
		}
		wg.Wait()
		if len(messages) != 4 {
			t.Fatalf("duplicate or missing threshold delivery: %d", len(messages))
		}
		seen := map[string]bool{}
		for _, message := range messages {
			if seen[message.ID] || strings.Contains(message.Text, "%!") || !strings.Contains(message.Text, "https://members.example/") || strings.Contains(message.Text, "operators.example") {
				t.Fatalf("wrong message identity, locale or site: %+v", message)
			}
			seen[message.ID] = true
		}
		if d.Client.BudgetNotice.Query().Where(budgetnotice.StateEQ("skipped")).CountX(ctx) != 2 {
			t.Fatal("stale 95% notices were not suppressed")
		}
	})
}

func TestNotificationFailureRetriesAndMembershipIsRechecked(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s, call, _, now := notificationFixture(t, d, "default_member")
		completeNoticeCall(t, s, call, Tokens{Input: 80, Output: 20}, Tokens{Input: 80})
		d.Client.Membership.Delete().Where(membership.TeamID(call.TeamID), membership.UserID(call.UserID)).ExecX(ctx)
		attempts := 0
		var firstID string
		s.SendNotice = func(ctx context.Context, message NoticeMessage) error {
			attempts++
			firstID = message.ID
			if message.To != "admin@notice.test" {
				t.Fatal("former member received usage metadata")
			}
			return &textproto.Error{Code: 451, Msg: "temporary failure"}
		}
		if err := s.DeliverNotices(ctx); err != nil {
			t.Fatal(err)
		}
		if err := s.DeliverNotices(ctx); err != nil {
			t.Fatal(err)
		}
		if attempts != 1 {
			t.Fatalf("backoff ignored or former member sent: %d", attempts)
		}
		*now = now.Add(3 * time.Minute)
		s.SendNotice = func(ctx context.Context, message NoticeMessage) error {
			attempts++
			if message.ID != firstID {
				t.Fatal("retry changed Message-ID")
			}
			return nil
		}
		if err := s.DeliverNotices(ctx); err != nil {
			t.Fatal(err)
		}
		if attempts != 2 || d.Client.BudgetNotice.Query().Where(budgetnotice.StateEQ("sent")).CountX(ctx) != 1 {
			t.Fatal("retry did not recover")
		}
		w := d.Client.BudgetWindow.Query().OnlyX(ctx)
		if w.SpentUnits != 80*UnitsPerPoint || w.ReservedUnits != 0 {
			t.Fatal("email failure changed budget settlement")
		}
	})
}
