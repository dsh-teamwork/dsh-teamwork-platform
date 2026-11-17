package team

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetevent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetgate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetreservation"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/modelrate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourceartifact"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourcesubmission"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// DeleteAccount closes the caller's account (docs/adr/0039-deleting-an-account.md).
// confirm must be the account's email, so a stray
// request cannot do it. A team the caller administers with anyone else in it
// refuses the whole deletion until the admin role is handed over; a team
// they are alone in is deleted with the account, and so is everything it
// holds. Their membership elsewhere goes, while what they did there (usage,
// published versions) stays with that team, under "former member".
//
// An edition hears TeamDeleted for each team and then AccountDeleted, in the
// same transaction, and may refuse either: the hosted edition refuses a team
// that still holds purchased credit.
func (s *Service) DeleteAccount(ctx context.Context, userID, confirm string) error {
	u, err := s.DB.User.Get(ctx, userID)
	if err != nil {
		return err
	}
	want := "DELETE"
	if u.Email != nil {
		want = *u.Email
	}
	if !strings.EqualFold(strings.TrimSpace(confirm), want) {
		return wire.E(http.StatusBadRequest, "confirmation_mismatch")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	admin, err := tx.Membership.Query().Where(membership.UserID(userID), membership.RoleEQ(membership.RoleAdmin)).All(ctx)
	if err != nil {
		return err
	}
	var solo []string
	for _, m := range admin {
		n, err := tx.Membership.Query().Where(membership.TeamID(m.TeamID)).Count(ctx)
		if err != nil {
			return err
		}
		if n > 1 {
			return wire.E(http.StatusConflict, "admin_of_shared_team")
		}
		solo = append(solo, m.TeamID)
	}
	var artifacts []*ent.ResourceArtifact
	for _, teamID := range solo {
		gone, err := deleteTeam(ctx, tx.Client(), teamID)
		if err != nil {
			return err
		}
		artifacts = append(artifacts, gone...)
		if err := s.changed(ctx, tx.Client(), edition.TeamChange{Kind: edition.TeamDeleted, TeamID: teamID, UserID: userID, ActorID: userID}); err != nil {
			return err
		}
	}
	if err := s.changed(ctx, tx.Client(), edition.TeamChange{Kind: edition.AccountDeleted, UserID: userID, ActorID: userID}); err != nil {
		return err
	}
	// Identities, the password and every membership go with the row.
	if err := tx.User.DeleteOneID(userID).Exec(ctx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	// The rows are gone, so nothing reaches these bytes any more; a file left
	// behind by a failed delete is logged, not a failed deletion.
	if s.Artifacts != nil {
		for _, a := range artifacts {
			if err := s.Artifacts.Delete(context.WithoutCancel(ctx), a.TeamID, a.ID); err != nil {
				slog.Warn("deleted team's artifact left in storage", "team", a.TeamID, "artifact", a.ID, "error", err)
			}
		}
	}
	return nil
}

// deleteTeam removes a team and every row that names it, and returns the
// artifacts whose stored bytes the caller deletes once this commits.
func deleteTeam(ctx context.Context, db *ent.Client, teamID string) ([]*ent.ResourceArtifact, error) {
	artifacts, err := db.ResourceArtifact.Query().Where(resourceartifact.TeamID(teamID)).All(ctx)
	if err != nil {
		return nil, err
	}
	windows, err := db.BudgetWindow.Query().Where(budgetwindow.TeamID(teamID)).IDs(ctx)
	if err != nil {
		return nil, err
	}
	steps := []func() (int, error){
		func() (int, error) {
			return db.BudgetReservation.Delete().Where(budgetreservation.WindowIDIn(windows...)).Exec(ctx)
		},
		func() (int, error) { return db.BudgetEvent.Delete().Where(budgetevent.TeamID(teamID)).Exec(ctx) },
		func() (int, error) { return db.BudgetNotice.Delete().Where(budgetnotice.TeamID(teamID)).Exec(ctx) },
		func() (int, error) { return db.BudgetWindow.Delete().Where(budgetwindow.TeamID(teamID)).Exec(ctx) },
		func() (int, error) { return db.BudgetPolicy.Delete().Where(budgetpolicy.TeamID(teamID)).Exec(ctx) },
		func() (int, error) { return db.BudgetGate.Delete().Where(budgetgate.ID(teamID)).Exec(ctx) },
		func() (int, error) { return db.UsageRequest.Delete().Where(usagerequest.TeamID(teamID)).Exec(ctx) },
		func() (int, error) { return db.ModelRate.Delete().Where(modelrate.TeamID(teamID)).Exec(ctx) },
		func() (int, error) {
			return db.ResourceSubmission.Delete().Where(resourcesubmission.TeamID(teamID)).Exec(ctx)
		},
		func() (int, error) { return db.ConfigRevision.Delete().Where(configrevision.TeamID(teamID)).Exec(ctx) },
		func() (int, error) {
			return db.ResourceArtifact.Delete().Where(resourceartifact.TeamID(teamID)).Exec(ctx)
		},
	}
	for _, step := range steps {
		if _, err := step(); err != nil {
			return nil, err
		}
	}
	// Memberships, configs, providers and invitations go with the row.
	if err := db.Team.DeleteOneID(teamID).Exec(ctx); err != nil {
		return nil, err
	}
	return artifacts, nil
}
