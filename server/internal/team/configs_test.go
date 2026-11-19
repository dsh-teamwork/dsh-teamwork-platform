package team

import (
	"context"
	"errors"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// An admin removes an owned model as any other, and its edition hears
// ModelRemoved with the configuration, in the same transaction; a preset that
// calls it still keeps it, and a member cannot remove it.
func TestAnAdminRemovesAnOwnedModelAndItsOwnerHears(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		var heard []edition.TeamChange
		s := &Service{DB: d.Client, Changed: func(_ context.Context, _ *ent.Client, change edition.TeamChange) error {
			heard = append(heard, change)
			return nil
		}}
		team := d.Client.Team.Create().SetName("Hosted").SaveX(ctx)
		admin := d.Client.User.Create().SetEmail("admin@owned.test").SaveX(ctx)
		member := d.Client.User.Create().SetEmail("member@owned.test").SaveX(ctx)
		d.Client.Membership.Create().SetTeamID(team.ID).SetUserID(admin.ID).SetRole(membership.RoleAdmin).ExecX(ctx)
		d.Client.Membership.Create().SetTeamID(team.ID).SetUserID(member.ID).SetRole(membership.RoleMember).ExecX(ctx)
		owned := func(id string) {
			d.Client.TeamConfig.Create().SetID(id).SetTeamID(team.ID).SetKind(teamconfig.KindModel).SetName(id).
				SetData([]byte(`{"provider":"hosted:billing","model":"astra","contextWindow":1000,"maxTokens":100}`)).
				SetRouteOwner("billing").SetRouteReference("astra").ExecX(ctx)
		}
		owned("used")
		owned("free")
		d.Client.TeamConfig.Create().SetTeamID(team.ID).SetKind(teamconfig.KindPreset).SetName("Preset").
			SetData([]byte(`{"modelConfigId":"used"}`)).ExecX(ctx)
		if err := s.DeleteConfig(ctx, member.ID, team.ID, "free"); code(err) != wire.AdminRequired {
			t.Fatalf("a member removed an owned model: %v", err)
		}
		if err := s.DeleteConfig(ctx, admin.ID, team.ID, "used"); code(err) != "model_in_use" {
			t.Fatalf("removed an owned model a preset calls: %v", err)
		}
		if err := s.DeleteConfig(ctx, admin.ID, team.ID, "free"); err != nil {
			t.Fatal(err)
		}
		if d.Client.TeamConfig.Query().Where(teamconfig.ID("free")).ExistX(ctx) {
			t.Fatal("the owned model is still there")
		}
		want := edition.TeamChange{Kind: edition.ModelRemoved, TeamID: team.ID, UserID: admin.ID, ActorID: admin.ID, ConfigID: "free"}
		if len(heard) != 1 || heard[0] != want {
			t.Fatalf("heard %+v", heard)
		}
	})
}

func code(err error) string {
	var e *wire.Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}
