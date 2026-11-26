package team

import (
	"context"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetexclusion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetselection"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Summary is one team in GET /api/teams.
type Summary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	MemberCount int    `json:"memberCount"`
}

// TeamsOf is every team the caller is in, the ones they joined first first.
func (s *Service) TeamsOf(ctx context.Context, userID string) ([]Summary, error) {
	ms, err := s.DB.Membership.Query().Where(membership.UserID(userID)).WithTeam().
		Order(ent.Asc(membership.FieldCreatedAt), ent.Asc(membership.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(ms))
	for _, m := range ms {
		ids = append(ids, m.TeamID)
	}
	var counts []struct {
		TeamID string `json:"team_id"`
		Count  int    `json:"count"`
	}
	if err := s.DB.Membership.Query().Where(membership.TeamIDIn(ids...)).
		GroupBy(membership.FieldTeamID).Aggregate(ent.Count()).Scan(ctx, &counts); err != nil {
		return nil, err
	}
	members := map[string]int{}
	for _, c := range counts {
		members[c.TeamID] = c.Count
	}
	out := make([]Summary, 0, len(ms))
	for _, m := range ms {
		out = append(out, Summary{ID: m.TeamID, Name: m.Edges.Team.Name, Role: string(m.Role), MemberCount: members[m.TeamID]})
	}
	return out, nil
}

// MemberView is one person in a team.
type MemberView struct {
	UserID string  `json:"userId"`
	Email  *string `json:"email"`
	Name   *string `json:"name,omitempty"`
	Role   string  `json:"role"`
}

// View is GET /api/teams/:teamId: the team, the caller's role and its members.
type View struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	Role    string       `json:"role"`
	Members []MemberView `json:"members"`
}

// TeamOf is a team the caller is in, with its members in the order they joined.
func (s *Service) TeamOf(ctx context.Context, userID, teamID string) (View, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return View{}, err
	}
	t, err := s.DB.Team.Get(ctx, m.TeamID)
	if err != nil {
		return View{}, err
	}
	members, err := s.DB.Membership.Query().Where(membership.TeamID(t.ID)).WithUser().
		Order(ent.Asc(membership.FieldCreatedAt), ent.Asc(membership.FieldID)).All(ctx)
	if err != nil {
		return View{}, err
	}
	v := View{ID: t.ID, Name: t.Name, Role: string(m.Role), Members: make([]MemberView, 0, len(members))}
	for _, mm := range members {
		v.Members = append(v.Members, MemberView{UserID: mm.UserID, Email: mm.Edges.User.Email, Name: mm.Edges.User.Name, Role: string(mm.Role)})
	}
	return v, nil
}

// LeaveTeam is a member leaving. The admin cannot: a team never ends up
// without one.
func (s *Service) LeaveTeam(ctx context.Context, userID, teamID string) error {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return err
	}
	if m.Role == membership.RoleAdmin {
		return wire.E(http.StatusBadRequest, "admin_cannot_leave")
	}
	// Scoped to the row just read: a membership changed since is not this one.
	return s.removeMembership(ctx, userID, m.TeamID)
}

// RemoveMember is an admin removing a member. An admin is never removed.
func (s *Service) RemoveMember(ctx context.Context, userID, teamID, target string) error {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return err
	}
	if target == userID {
		return wire.E(http.StatusBadRequest, "cannot_remove_self")
	}
	return s.removeMembership(ctx, target, admin.TeamID)
}

func (s *Service) removeMembership(ctx context.Context, userID, teamID string) error {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	deleted, err := tx.Membership.Delete().Where(membership.UserID(userID), membership.TeamID(teamID), membership.RoleEQ(membership.RoleMember)).Exec(ctx)
	if err != nil || deleted == 0 {
		return err
	}
	if _, err := tx.AssetSelection.Delete().Where(assetselection.TeamID(teamID), assetselection.UserID(userID)).Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.AssetExclusion.Delete().Where(assetexclusion.TeamID(teamID), assetexclusion.UserID(userID)).Exec(ctx); err != nil {
		return err
	}
	if err := tx.TeamConfig.Update().Where(teamconfig.TeamID(teamID), teamconfig.AssetOwnerID(userID), teamconfig.Or(teamconfig.AssetArchived(false), teamconfig.AssetOwnerWithdrawn(true))).SetAssetArchived(true).SetAssetOwnerWithdrawn(false).Exec(ctx); err != nil {
		return err
	}
	return tx.Commit()
}

// AddedMember is POST /api/teams/:teamId/members: the first password the
// only time it is seen, or null when the address already had an account,
// whose own password stands.
type AddedMember struct {
	UserID   string  `json:"userId"`
	Email    string  `json:"email"`
	Password *string `json:"password"`
}

func passwordsOff() error { return wire.E(http.StatusBadRequest, "passwords_off") }

// AddMember is an admin adding someone by email, where the instance holds
// passwords (ADR 0006). A new account gets a first password its owner must
// change at first sign-in; an existing one, whatever other teams it is in
// and whether or not it has a password, is added as it is.
func (s *Service) AddMember(ctx context.Context, userID, teamID string, in wire.AddMember) (AddedMember, error) {
	if !s.Passwords {
		return AddedMember{}, passwordsOff()
	}
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return AddedMember{}, err
	}
	first := auth.GeneratePassword()
	hash, err := auth.HashPassword(first)
	if err != nil {
		return AddedMember{}, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return AddedMember{}, err
	}
	defer tx.Rollback()
	user, created, err := auth.EnsureEmailUser(ctx, tx, in.Email)
	if err != nil {
		return AddedMember{}, conflict(err, "member_in_team")
	}
	if in, err := tx.Membership.Query().Where(membership.UserID(user.ID), membership.TeamID(admin.TeamID)).Exist(ctx); err != nil || in {
		if err == nil {
			err = wire.E(http.StatusConflict, "member_in_team")
		}
		return AddedMember{}, err
	}
	out := AddedMember{UserID: user.ID, Email: in.Email}
	// Only an account made here gets a first password. An existing one keeps
	// whatever doors it has: one with no password (signed up with Google)
	// must not get one an admin knows, or the admin would hold that account
	// and its place in every other team (ADR 0013).
	if created {
		if s.ProtectedAccount != nil && s.ProtectedAccount(in.Email) {
			return AddedMember{}, wire.E(http.StatusForbidden, wire.NotAllowed)
		}
		if err := tx.Password.Create().SetUserID(user.ID).SetHash(hash).SetMustChange(true).Exec(ctx); err != nil {
			return AddedMember{}, conflict(err, "member_in_team")
		}
		out.Password = &first
	}
	if err := tx.Membership.Create().SetUserID(user.ID).SetTeamID(admin.TeamID).SetRole(membership.RoleMember).Exec(ctx); err != nil {
		return AddedMember{}, conflict(err, "member_in_team")
	}
	if err := s.changed(ctx, tx.Client(), edition.TeamChange{Kind: edition.MemberJoined, TeamID: admin.TeamID, UserID: user.ID, ActorID: userID}); err != nil {
		return AddedMember{}, err
	}
	return out, conflict(tx.Commit(), "member_in_team")
}

// ResetMemberPassword is an admin giving a member a new first password, shown
// once. Only for a member of the admin's own team, never the admin's own,
// and never someone also in another team (ADR 0013): the password opens the
// whole account, so an admin of one team would take over that person's place
// in every other.
func (s *Service) ResetMemberPassword(ctx context.Context, userID, teamID, target string) (string, error) {
	if !s.Passwords {
		return "", passwordsOff()
	}
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return "", err
	}
	if target == userID {
		return "", wire.E(http.StatusBadRequest, "cannot_reset_self")
	}
	ms, err := s.DB.Membership.Query().Where(membership.UserID(target)).All(ctx)
	if err != nil {
		return "", err
	}
	inTeam := false
	for _, m := range ms {
		inTeam = inTeam || m.TeamID == admin.TeamID
	}
	if !inTeam {
		return "", wire.E(http.StatusNotFound, "not_a_member")
	}
	if len(ms) > 1 {
		return "", wire.E(http.StatusForbidden, "member_in_other_team")
	}
	account, err := s.DB.User.Get(ctx, target)
	if err != nil {
		return "", err
	}
	if account.Email != nil && s.ProtectedAccount != nil && s.ProtectedAccount(*account.Email) {
		return "", wire.E(http.StatusForbidden, wire.NotAllowed)
	}
	pw := auth.GeneratePassword()
	return pw, s.Auth.SetPassword(ctx, target, pw, true)
}

// conflict turns a unique-index violation into code, a 409.
func conflict(err error, code string) error {
	if err != nil && ent.IsConstraintError(err) {
		return wire.E(http.StatusConflict, code)
	}
	return err
}

// HandOverAdmin is an admin making another member the team's admin; the
// caller becomes a member. A team keeps exactly one admin, so the two roles
// swap in one transaction, and only from the row just read.
func (s *Service) HandOverAdmin(ctx context.Context, userID, teamID, target string) error {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return err
	}
	if target == userID {
		return wire.E(http.StatusBadRequest, "already_admin")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	n, err := tx.Membership.Update().Where(membership.UserID(target), membership.TeamID(admin.TeamID), membership.RoleEQ(membership.RoleMember)).
		SetRole(membership.RoleAdmin).Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return wire.E(http.StatusNotFound, "member_not_found")
	}
	n, err = tx.Membership.Update().Where(membership.UserID(userID), membership.TeamID(admin.TeamID), membership.RoleEQ(membership.RoleAdmin)).
		SetRole(membership.RoleMember).Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		// Somebody else changed this admin's row since it was read.
		return wire.E(http.StatusForbidden, wire.AdminRequired)
	}
	return tx.Commit()
}
