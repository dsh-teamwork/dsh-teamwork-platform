package artifacts

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifact"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactfile"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactmember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifactversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Sharing is an artifact's sharing as PUT …/sharing takes it.
type Sharing struct {
	Mode    string   `json:"mode"`
	Members []string `json:"members"`
}

// role is how the caller stands to an artifact of their team: its owner, the
// team's admin, or neither. Only an owner widens an artifact's sharing; an admin
// governs every artifact without reading it (docs/tech/artifacts.md, "Terms").
type role int

const (
	other role = iota
	admin
	owner
)

// governed is an artifact of the team and the caller's role over it; an artifact they
// can neither read nor govern is artifact_not_found, so its existence is not told.
func (s *Service) governed(ctx context.Context, c Caller, teamID, artifactID string) (*ent.Artifact, role, error) {
	m, err := s.member(ctx, c, teamID)
	if err != nil {
		return nil, other, err
	}
	p, err := s.DB.Artifact.Query().Where(artifact.ID(artifactID), artifact.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, other, notFound()
	}
	if err != nil {
		return nil, other, err
	}
	switch {
	case p.OwnerID == c.UserID:
		return p, owner, nil
	case m.Role == membership.RoleAdmin:
		return p, admin, nil
	}
	ok, err := s.reads(ctx, c.UserID, p)
	if err != nil {
		return nil, other, err
	}
	if !ok {
		return nil, other, notFound()
	}
	return p, other, nil
}

func notOwner() error { return wire.E(http.StatusForbidden, "artifact_not_owner") }

// admitted is who a sharing lets read besides the owner: nil with all=true
// for the whole team.
func (s *Service) admitted(ctx context.Context, p *ent.Artifact) (ids map[string]bool, all bool, err error) {
	switch p.Sharing {
	case artifact.SharingTeam:
		return nil, true, nil
	case artifact.SharingMembers:
		rows, err := s.DB.ArtifactMember.Query().Where(artifactmember.ArtifactID(p.ID)).All(ctx)
		if err != nil {
			return nil, false, err
		}
		ids = map[string]bool{}
		for _, r := range rows {
			ids[r.UserID] = true
		}
		return ids, false, nil
	}
	return map[string]bool{}, false, nil
}

// SetSharing sets an artifact's sharing: private, chosen members of its team, or
// the whole team. The owner sets any; an admin only narrows it, admitting no
// one it did not admit before, so an admin cannot share an artifact to read it.
func (s *Service) SetSharing(ctx context.Context, c Caller, teamID, artifactID string, in Sharing) error {
	p, r, err := s.governed(ctx, c, teamID, artifactID)
	if err != nil {
		return err
	}
	if r == other {
		return notOwner()
	}
	chosen := map[string]bool{}
	switch in.Mode {
	case "private", "team":
		if len(in.Members) != 0 {
			return invalid("Members go with mode members alone", "members")
		}
	case "members":
		if len(in.Members) == 0 || len(in.Members) > 500 {
			return invalid("Choose at least one member", "members")
		}
		for _, id := range in.Members {
			if id == p.OwnerID || len(id) > 32 {
				return invalid("Choose members other than the owner", "members")
			}
			chosen[id] = true
		}
		ids := make([]string, 0, len(chosen))
		for id := range chosen {
			ids = append(ids, id)
		}
		n, err := s.DB.Membership.Query().Where(membership.TeamID(teamID), membership.UserIDIn(ids...)).Count(ctx)
		if err != nil {
			return err
		}
		if n != len(ids) {
			return wire.E(http.StatusBadRequest, "artifact_member_not_in_team")
		}
	default:
		return invalid("private, members or team", "mode")
	}
	if r == admin {
		before, all, err := s.admitted(ctx, p)
		if err != nil {
			return err
		}
		widened := in.Mode == "team" && !all
		for id := range chosen {
			widened = widened || (!all && !before[id])
		}
		if widened {
			return wire.E(http.StatusForbidden, "artifact_sharing_widened")
		}
	}
	return withTx(ctx, s.DB, func(tx *ent.Tx) error {
		if err := tx.Artifact.UpdateOneID(p.ID).SetSharing(artifact.Sharing(in.Mode)).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.ArtifactMember.Delete().Where(artifactmember.ArtifactID(p.ID)).Exec(ctx); err != nil {
			return err
		}
		if len(chosen) == 0 {
			return nil
		}
		rows := make([]*ent.ArtifactMemberCreate, 0, len(chosen))
		for id := range chosen {
			rows = append(rows, tx.ArtifactMember.Create().SetArtifactID(p.ID).SetUserID(id).SetAddedBy(c.UserID))
		}
		return tx.ArtifactMember.CreateBulk(rows...).Exec(ctx)
	})
}

// Rename sets an artifact's title; its owner's alone.
func (s *Service) Rename(ctx context.Context, c Caller, teamID, artifactID, title string) error {
	p, r, err := s.governed(ctx, c, teamID, artifactID)
	if err != nil {
		return err
	}
	if r != owner {
		return notOwner()
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 120 {
		return invalid("A title of at most 120 characters", "title")
	}
	return s.DB.Artifact.UpdateOneID(p.ID).SetTitle(title).Exec(ctx)
}

// Restore adds a version copying version n's files: the owner's alone. Its
// bytes are already stored, so nothing is written but rows.
func (s *Service) Restore(ctx context.Context, c Caller, teamID, artifactID string, n int) (Published, error) {
	p, r, err := s.governed(ctx, c, teamID, artifactID)
	if err != nil {
		return Published{}, err
	}
	if r != owner {
		return Published{}, notOwner()
	}
	old, err := s.version(ctx, p.ID, n)
	if err != nil {
		return Published{}, err
	}
	files, err := s.DB.ArtifactFile.Query().Where(artifactfile.VersionID(old.ID)).All(ctx)
	if err != nil {
		return Published{}, err
	}
	next := p.CurrentVersion + 1
	at := s.now()
	err = withTx(ctx, s.DB, func(tx *ent.Tx) error {
		changed, err := tx.Artifact.Update().Where(artifact.ID(p.ID), artifact.CurrentVersion(p.CurrentVersion)).SetCurrentVersion(next).SetUpdatedAt(at).Save(ctx)
		if err == nil && changed == 0 {
			return wire.E(http.StatusConflict, "artifact_stale")
		}
		if err != nil {
			return err
		}
		v, err := tx.ArtifactVersion.Create().SetArtifactID(p.ID).SetNumber(next).SetAuthorID(c.UserID).SetSize(old.Size).
			SetNote(restoredNote(n)).SetCreatedAt(at).Save(ctx)
		if err != nil {
			return err
		}
		rows := make([]*ent.ArtifactFileCreate, len(files))
		for i, f := range files {
			rows[i] = tx.ArtifactFile.Create().SetVersionID(v.ID).SetTeamID(teamID).SetPath(f.Path).SetContentType(f.ContentType).SetSize(f.Size).SetDigest(f.Digest)
		}
		return tx.ArtifactFile.CreateBulk(rows...).Exec(ctx)
	})
	if err != nil {
		return Published{}, err
	}
	return Published{ID: p.ID, TeamID: teamID, Version: next, Title: p.Title, Kind: string(p.Kind)}, nil
}

func restoredNote(n int) string { return "Restored version " + strconv.Itoa(n) }

// Delete deletes an artifact, its versions, files and members, then each of its
// objects no other artifact of the team names. The owner or the team's admin.
func (s *Service) Delete(ctx context.Context, c Caller, teamID, artifactID string) error {
	p, r, err := s.governed(ctx, c, teamID, artifactID)
	if err != nil {
		return err
	}
	if r == other {
		return notOwner()
	}
	versions, err := s.DB.ArtifactVersion.Query().Where(artifactversion.ArtifactID(p.ID)).IDs(ctx)
	if err != nil {
		return err
	}
	var digests []string
	if err := s.DB.ArtifactFile.Query().Where(artifactfile.VersionIDIn(versions...)).Unique(true).Select(artifactfile.FieldDigest).Scan(ctx, &digests); err != nil {
		return err
	}
	err = withTx(ctx, s.DB, func(tx *ent.Tx) error {
		if _, err := tx.ArtifactMember.Delete().Where(artifactmember.ArtifactID(p.ID)).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.ArtifactFile.Delete().Where(artifactfile.VersionIDIn(versions...)).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.ArtifactVersion.Delete().Where(artifactversion.ArtifactID(p.ID)).Exec(ctx); err != nil {
			return err
		}
		return tx.Artifact.DeleteOneID(p.ID).Exec(ctx)
	})
	if err != nil {
		return err
	}
	if s.Store != nil {
		s.forget(teamID, digests)
	}
	return nil
}
