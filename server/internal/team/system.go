package team

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/identity"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/password"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/plugingrant"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

var systemID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// CreateSystemTeam makes a team owned by an account with no sign-in door. Both
// ids are stable so an interrupted bootstrap can safely try again.
func (s *Service) CreateSystemTeam(ctx context.Context, in edition.SystemTeamInput) (edition.SystemTeam, error) {
	in.ID = strings.TrimSpace(in.ID)
	in.OwnerID = strings.TrimSpace(in.OwnerID)
	in.OwnerName = strings.TrimSpace(in.OwnerName)
	if !systemID.MatchString(in.ID) || len(in.ID) > 32 || !systemID.MatchString(in.OwnerID) || len(in.OwnerID) > 32 || in.OwnerName == "" || utf8.RuneCountInString(in.OwnerName) > 80 {
		return edition.SystemTeam{}, fmt.Errorf("invalid system team owner")
	}
	teamInput := wire.CreateTeam{Name: in.Name}
	if err := teamInput.Validate(); err != nil {
		return edition.SystemTeam{}, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return edition.SystemTeam{}, err
	}
	defer tx.Rollback()
	owner, err := systemOwner(ctx, tx, in.OwnerID, in.OwnerName)
	if err != nil {
		return edition.SystemTeam{}, err
	}
	existing, err := tx.Team.Get(ctx, in.ID)
	if err == nil {
		var role *ent.Membership
		role, err = tx.Membership.Query().Where(membership.TeamID(existing.ID), membership.UserID(owner.ID), membership.RoleEQ(membership.RoleAdmin)).Only(ctx)
		if err == nil {
			return edition.SystemTeam{ID: existing.ID, Name: existing.Name, OwnerID: role.UserID}, nil
		}
		return edition.SystemTeam{}, fmt.Errorf("system team id is already in use")
	}
	if !ent.IsNotFound(err) {
		return edition.SystemTeam{}, err
	}
	created, err := s.createInTx(ctx, tx, owner.ID, teamInput, in.Locale, true, in.ID)
	if err != nil {
		return edition.SystemTeam{}, err
	}
	if err := tx.Commit(); err != nil {
		return edition.SystemTeam{}, err
	}
	return edition.SystemTeam{ID: created.ID, Name: created.Name, OwnerID: owner.ID}, nil
}

// JoinMember adds an existing account as an ordinary member without an
// invitation. Existing membership, including an administrator's, is unchanged.
func (s *Service) JoinMember(ctx context.Context, userID, teamID string) (bool, error) {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	exists, err := tx.Membership.Query().Where(membership.UserID(userID), membership.TeamID(teamID)).Exist(ctx)
	if err != nil || exists {
		return false, err
	}
	if _, err := tx.User.Get(ctx, userID); err != nil {
		return false, err
	}
	if _, err := tx.Team.Get(ctx, teamID); err != nil {
		return false, err
	}
	if err := tx.Membership.Create().SetUserID(userID).SetTeamID(teamID).SetRole(membership.RoleMember).Exec(ctx); err != nil {
		if ent.IsConstraintError(err) {
			return false, nil
		}
		return false, err
	}
	change := edition.TeamChange{Kind: edition.MemberJoined, TeamID: teamID, UserID: userID, ActorID: userID, System: true}
	if err := s.changed(ctx, tx.Client(), change); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func systemOwner(ctx context.Context, tx *ent.Tx, id, name string) (*ent.User, error) {
	owner, err := tx.User.Get(ctx, id)
	if ent.IsNotFound(err) {
		return tx.User.Create().SetID(id).SetName(name).Save(ctx)
	}
	if err != nil {
		return nil, err
	}
	doors, err := tx.Identity.Query().Where(identity.UserID(id)).Count(ctx)
	if err != nil {
		return nil, err
	}
	passwords, err := tx.Password.Query().Where(password.UserID(id)).Count(ctx)
	if err != nil {
		return nil, err
	}
	grants, err := tx.PluginGrant.Query().Where(plugingrant.UserID(id)).Count(ctx)
	if err != nil {
		return nil, err
	}
	if owner.Email != nil || doors+passwords+grants != 0 {
		return nil, fmt.Errorf("system team owner is a personal account")
	}
	return owner, nil
}
