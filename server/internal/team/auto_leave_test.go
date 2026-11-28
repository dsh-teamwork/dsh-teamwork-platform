package team

import (
	"context"
	"fmt"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func TestAutoLeaveTrialTeamOnCreateAndJoin(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		s := &Service{DB: d.Client, AutoLeaveTeam: "demo"}
		demo, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "demo-owner", OwnerName: "System", Name: "Demo", Locale: "en"})
		if err != nil {
			t.Fatal(err)
		}
		user := d.Client.User.Create().SetEmail("member@example.test").SaveX(ctx)
		if _, err := s.JoinMember(ctx, user.ID, demo.ID); err != nil {
			t.Fatal(err)
		}
		assertMembership(t, ctx, d.Client, user.ID, demo.ID, true, "joining the demo itself must not auto-leave")

		created, err := s.CreateTeam(ctx, user.ID, wire.CreateTeam{Name: "Own team"}, "en")
		if err != nil {
			t.Fatal(err)
		}
		assertMembership(t, ctx, d.Client, user.ID, demo.ID, false, "creating another team must leave the demo")
		assertMembership(t, ctx, d.Client, user.ID, created.ID, true, "the new team must remain")

		if _, err := s.JoinMember(ctx, user.ID, demo.ID); err != nil {
			t.Fatal(err)
		}
		assertMembership(t, ctx, d.Client, user.ID, demo.ID, true, "rejoining the demo must work")
		invite, err := s.CreateInvite(ctx, user.ID, created.ID)
		if err != nil {
			t.Fatal(err)
		}
		other := d.Client.User.Create().SetEmail("invitee@example.test").SaveX(ctx)
		if _, err := s.RedeemInvite(ctx, other.ID, wire.RedeemInvite{Token: invite.Token}); err != nil {
			t.Fatal(err)
		}
		assertMembership(t, ctx, d.Client, other.ID, demo.ID, false, "a user who never joined the demo needs no exit")
		assertMembership(t, ctx, d.Client, other.ID, created.ID, true, "the invitee joined the ordinary team")

		if _, err := s.JoinMember(ctx, other.ID, demo.ID); err != nil {
			t.Fatal(err)
		}
		second, err := s.CreateTeam(ctx, user.ID, wire.CreateTeam{Name: "Second team"}, "en")
		if err != nil {
			t.Fatal(err)
		}
		invite2, err := s.CreateInvite(ctx, user.ID, second.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.RedeemInvite(ctx, other.ID, wire.RedeemInvite{Token: invite2.Token}); err != nil {
			t.Fatal(err)
		}
		assertMembership(t, ctx, d.Client, other.ID, demo.ID, false, "accepting an invitation must leave the demo")

		m, err := d.Client.Membership.Query().Where(membership.TeamID(demo.ID), membership.UserID(demo.OwnerID)).Only(ctx)
		if err != nil || m.Role != membership.RoleAdmin {
			t.Fatalf("system owner membership: %#v, %v", m, err)
		}
	})
}

func TestAutoLeaveRunsInsideTheCreationTransaction(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		var subscribed bool
		s := &Service{DB: d.Client, AutoLeaveTeam: "demo", Changed: func(ctx context.Context, db *ent.Client, change edition.TeamChange) error {
			if change.Kind == edition.TeamCreated && !change.System {
				subscribed = true
				n, err := db.Membership.Query().Where(membership.TeamID("demo"), membership.UserID(change.UserID)).Count(ctx)
				if err != nil {
					return err
				}
				if n != 0 {
					return fmt.Errorf("demo membership survived the creation transaction")
				}
			}
			return nil
		}}
		if _, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "demo-owner", OwnerName: "System", Name: "Demo", Locale: "en"}); err != nil {
			t.Fatal(err)
		}
		user := d.Client.User.Create().SetEmail("member@example.test").SaveX(ctx)
		if _, err := s.JoinMember(ctx, user.ID, "demo"); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateTeam(ctx, user.ID, wire.CreateTeam{Name: "Own team"}, "en"); err != nil {
			t.Fatal(err)
		}
		if !subscribed {
			t.Fatal("creation event was not observed")
		}
	})
}

func assertMembership(t *testing.T, ctx context.Context, client *ent.Client, userID, teamID string, want bool, why string) {
	t.Helper()
	exists, err := client.Membership.Query().Where(membership.UserID(userID), membership.TeamID(teamID)).Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if exists != want {
		t.Fatalf("membership %s/%s = %v, want %v: %s", userID, teamID, exists, want, why)
	}
}
