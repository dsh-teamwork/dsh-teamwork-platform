package team

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifact"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactfile"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactmember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetevent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetgate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetreservation"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetwindow"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/modelrate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pluginpackage"
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
	var packages []*ent.PluginPackage
	var objects []artifactObject
	for _, teamID := range solo {
		gone, files, err := deleteTeam(ctx, tx.Client(), teamID)
		if err != nil {
			return err
		}
		packages = append(packages, gone...)
		objects = append(objects, files...)
		if err := s.changed(ctx, tx.Client(), edition.TeamChange{Kind: edition.TeamDeleted, TeamID: teamID, UserID: userID, ActorID: userID}); err != nil {
			return err
		}
	}
	// Their private artifacts in other teams go with them, since nobody else
	// can read them; artifacts they shared stay with their team, as their published
	// versions do, and lists that named them forget them (docs/tech/artifacts.md).
	private, err := tx.Artifact.Query().Where(artifact.OwnerID(userID), artifact.SharingEQ(artifact.SharingPrivate)).All(ctx)
	if err != nil {
		return err
	}
	for _, p := range private {
		files, err := deleteArtifacts(ctx, tx.Client(), p.TeamID, []string{p.ID})
		if err != nil {
			return err
		}
		objects = append(objects, files...)
	}
	if _, err := tx.ArtifactMember.Delete().Where(artifactmember.UserID(userID)).Exec(ctx); err != nil {
		return err
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
	s.forgetStored(ctx, packages, objects)
	return nil
}

// DeleteTeam is its admin deleting a team, with everyone in it and everything
// it holds (docs/adr/0056-an-admin-deletes-a-team.md). confirm must be the
// team's name, so a stray request cannot do it. Its members lose it at their
// next request, as a removed member does; what they did in it goes with it.
//
// An edition hears TeamDeleted in the same transaction and may refuse it: the
// hosted edition refuses a team that still holds purchased credit.
func (s *Service) DeleteTeam(ctx context.Context, userID, teamID, confirm string) error {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Read inside the transaction: an admin role handed over meanwhile is not this one.
	m, err := tx.Membership.Query().Where(membership.UserID(userID), membership.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(http.StatusNotFound, wire.TeamNotFound)
	}
	if err != nil {
		return err
	}
	if m.Role != membership.RoleAdmin {
		return wire.E(http.StatusForbidden, wire.AdminRequired)
	}
	t, err := tx.Team.Get(ctx, m.TeamID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(confirm) != strings.TrimSpace(t.Name) {
		return wire.E(http.StatusBadRequest, "confirmation_mismatch")
	}
	packages, objects, err := deleteTeam(ctx, tx.Client(), t.ID)
	if err != nil {
		return err
	}
	if err := s.changed(ctx, tx.Client(), edition.TeamChange{Kind: edition.TeamDeleted, TeamID: t.ID, UserID: userID, ActorID: userID}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.forgetStored(ctx, packages, objects)
	return nil
}

// forgetStored deletes the stored bytes of deleted teams' packages and artifacts.
// The rows are gone, so nothing reaches these bytes any more; a file left
// behind by a failed delete is logged, not a failed deletion.
func (s *Service) forgetStored(ctx context.Context, packages []*ent.PluginPackage, objects []artifactObject) {
	if s.Objects == nil {
		return
	}
	ctx = context.WithoutCancel(ctx)
	for _, a := range packages {
		if err := s.Objects.Delete(ctx, a.TeamID, a.ID); err != nil {
			slog.Warn("deleted team's package left in storage", "team", a.TeamID, "package", a.ID, "error", err)
		}
	}
	s.forgetArtifactObjects(ctx, objects)
}

// artifactObject is an artifact file's object in the store:
// teams/{team}/pages/{digest}, the kind artifacts were first stored under.
type artifactObject struct{ team, digest string }

// deleteArtifacts removes artifacts of a team with their versions, files and members,
// and returns the objects their files named.
func deleteArtifacts(ctx context.Context, db *ent.Client, teamID string, ids []string) ([]artifactObject, error) {
	versions, err := db.ArtifactVersion.Query().Where(artifactversion.ArtifactIDIn(ids...)).IDs(ctx)
	if err != nil {
		return nil, err
	}
	var digests []string
	if err := db.ArtifactFile.Query().Where(artifactfile.VersionIDIn(versions...)).Unique(true).Select(artifactfile.FieldDigest).Scan(ctx, &digests); err != nil {
		return nil, err
	}
	if _, err := db.ArtifactMember.Delete().Where(artifactmember.ArtifactIDIn(ids...)).Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := db.ArtifactFile.Delete().Where(artifactfile.VersionIDIn(versions...)).Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := db.ArtifactVersion.Delete().Where(artifactversion.ArtifactIDIn(ids...)).Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := db.Artifact.Delete().Where(artifact.IDIn(ids...)).Exec(ctx); err != nil {
		return nil, err
	}
	out := make([]artifactObject, len(digests))
	for i, d := range digests {
		out[i] = artifactObject{teamID, d}
	}
	return out, nil
}

// forgetArtifactObjects deletes the objects no artifact file of their team still names.
// A file left behind by a failed delete is logged, not a failed deletion.
func (s *Service) forgetArtifactObjects(ctx context.Context, objects []artifactObject) {
	for _, o := range objects {
		named, err := s.DB.ArtifactFile.Query().Where(artifactfile.TeamID(o.team), artifactfile.Digest(o.digest)).Exist(ctx)
		if err != nil || named {
			continue
		}
		if err := s.Objects.DeleteObject(ctx, o.team, "pages", o.digest); err != nil {
			slog.Warn("deleted artifact's file left in storage", "team", o.team, "digest", o.digest, "error", err)
		}
	}
}

// deleteTeam removes a team and every row that names it, and returns the
// packages and artifact objects whose stored bytes the caller deletes once this
// commits.
func deleteTeam(ctx context.Context, db *ent.Client, teamID string) ([]*ent.PluginPackage, []artifactObject, error) {
	packages, err := db.PluginPackage.Query().Where(pluginpackage.TeamID(teamID)).All(ctx)
	if err != nil {
		return nil, nil, err
	}
	artifactIDs, err := db.Artifact.Query().Where(artifact.TeamID(teamID)).IDs(ctx)
	if err != nil {
		return nil, nil, err
	}
	objects, err := deleteArtifacts(ctx, db, teamID, artifactIDs)
	if err != nil {
		return nil, nil, err
	}
	windows, err := db.BudgetWindow.Query().Where(budgetwindow.TeamID(teamID)).IDs(ctx)
	if err != nil {
		return nil, nil, err
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
			return db.PluginPackage.Delete().Where(pluginpackage.TeamID(teamID)).Exec(ctx)
		},
	}
	for _, step := range steps {
		if _, err := step(); err != nil {
			return nil, nil, err
		}
	}
	// Memberships, configs, providers and invitations go with the row.
	if err := db.Team.DeleteOneID(teamID).Exec(ctx); err != nil {
		return nil, nil, err
	}
	return packages, objects, nil
}
