package team

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/invite"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// InviteTTL is how long an invitation stays good.
const InviteTTL = 24 * time.Hour

// InviteView is an invitation as its admin sees it: never the token.
type InviteView struct {
	ID        string  `json:"id"`
	ExpiresAt string  `json:"expiresAt"`
	UsedAt    *string `json:"usedAt"`
}

// CreatedInvite is POST /api/teams/:teamId/invites: the only time the token
// itself is seen.
type CreatedInvite struct {
	InviteView
	Token string `json:"token"`
}

func inviteView(i *ent.Invite) InviteView {
	v := InviteView{ID: i.ID, ExpiresAt: Time(i.ExpiresAt)}
	if i.UsedAt != nil {
		used := Time(*i.UsedAt)
		v.UsedAt = &used
	}
	return v
}

// sha256Hex is how a token is stored: its hash, never itself.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// ListInvites is a team's invitations, newest first.
func (s *Service) ListInvites(ctx context.Context, userID, teamID string) ([]InviteView, error) {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.Invite.Query().Where(invite.TeamID(admin.TeamID)).Order(ent.Desc(invite.FieldCreatedAt), ent.Desc(invite.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]InviteView, 0, len(rows))
	for _, r := range rows {
		out = append(out, inviteView(r))
	}
	return out, nil
}

// CreateInvite is a single-use invitation good for a day.
func (s *Service) CreateInvite(ctx context.Context, userID, teamID string) (CreatedInvite, error) {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return CreatedInvite{}, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return CreatedInvite{}, err
	}
	token := b64.EncodeToString(raw)
	i, err := s.DB.Invite.Create().SetTeamID(admin.TeamID).SetTokenHash(sha256Hex(token)).SetExpiresAt(s.now().Add(InviteTTL)).Save(ctx)
	if err != nil {
		return CreatedInvite{}, err
	}
	return CreatedInvite{InviteView: inviteView(i), Token: token}, nil
}

// RevokeInvite deletes an invitation of the admin's team.
func (s *Service) RevokeInvite(ctx context.Context, userID, teamID, inviteID string) error {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return err
	}
	_, err = s.DB.Invite.Delete().Where(invite.ID(inviteID), invite.TeamID(admin.TeamID)).Exec(ctx)
	return err
}

// RedeemInvite spends an invitation and joins its team, atomically: two
// people racing for one token get one seat. Someone already in that team
// keeps the invitation unspent; being in other teams does not matter.
func (s *Service) RedeemInvite(ctx context.Context, userID string, in wire.RedeemInvite) (string, error) {
	now := s.now()
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	i, err := tx.Invite.Query().Where(invite.TokenHash(sha256Hex(in.Token))).Only(ctx)
	if ent.IsNotFound(err) || (err == nil && !i.ExpiresAt.After(now)) {
		return "", wire.E(http.StatusBadRequest, "invite_invalid")
	}
	if err != nil {
		return "", err
	}
	if member, err := tx.Membership.Query().Where(membership.UserID(userID), membership.TeamID(i.TeamID)).Exist(ctx); err != nil || member {
		if err == nil {
			err = wire.E(http.StatusConflict, "already_in_team")
		}
		return "", err
	}
	claimed, err := tx.Invite.Update().Where(invite.ID(i.ID), invite.UsedAtIsNil(), invite.ExpiresAtGT(now)).SetUsedAt(now).Save(ctx)
	if err != nil {
		return "", err
	}
	if claimed == 0 {
		return "", wire.E(http.StatusConflict, "invite_used")
	}
	if err := tx.Membership.Create().SetUserID(userID).SetTeamID(i.TeamID).SetRole(membership.RoleMember).Exec(ctx); err != nil {
		return "", conflict(err, "already_in_team")
	}
	return i.TeamID, conflict(tx.Commit(), "already_in_team")
}
