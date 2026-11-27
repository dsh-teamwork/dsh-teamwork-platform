package team

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifact"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetexclusion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetselection"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgespace"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pluginpackage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourcesubmission"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

var seedID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

type preparedConfig struct {
	id    string
	input wire.ConfigInput
}

type preparedArtifact struct {
	id, kind, title, digest string
	content                 []byte
}

// ResetTeamContent replaces everything a member can change with a small seed.
// The team, its members, built-in assistant, models, budgets, usage and wallet
// stay in place. Seed bytes are stored outside the database transaction; no
// network or object-store work happens inside it.
func (s *Service) ResetTeamContent(ctx context.Context, teamID, ownerID string, seed edition.TeamSeed) (err error) {
	configs, artifacts, err := prepareSeed(seed)
	if err != nil {
		return err
	}
	written := make([]artifactObject, 0, len(artifacts))
	committed := false
	defer func() {
		if !committed && len(written) > 0 {
			s.forgetArtifactObjects(context.WithoutCancel(ctx), written)
		}
	}()
	for _, a := range artifacts {
		if s.Objects == nil {
			return fmt.Errorf("artifact object store is unavailable")
		}
		if err := s.Objects.PutObject(ctx, teamID, "pages", a.digest, bytes.NewReader(a.content), int64(len(a.content))); err != nil {
			return err
		}
		written = append(written, artifactObject{team: teamID, digest: a.digest})
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	owner, err := tx.Membership.Query().Where(membership.TeamID(teamID), membership.UserID(ownerID), membership.RoleEQ(membership.RoleAdmin)).Exist(ctx)
	if err != nil || !owner {
		if err == nil {
			err = fmt.Errorf("seed owner is not a team administrator")
		}
		return err
	}

	// Personal choices and publication history belong to the content being
	// replaced, not to the members or their usage history.
	if _, err = tx.AssetSelection.Delete().Where(assetselection.TeamID(teamID)).Exec(ctx); err != nil {
		return err
	}
	if _, err = tx.AssetExclusion.Delete().Where(assetexclusion.TeamID(teamID)).Exec(ctx); err != nil {
		return err
	}
	if _, err = tx.ResourceSubmission.Delete().Where(resourcesubmission.TeamID(teamID)).Exec(ctx); err != nil {
		return err
	}
	memberConfigs, err := tx.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.KindNEQ(teamconfig.KindModel), teamconfig.BuiltinIsNil()).All(ctx)
	if err != nil {
		return err
	}
	configIDs := make([]string, 0, len(memberConfigs))
	for _, c := range memberConfigs {
		configIDs = append(configIDs, c.ID)
	}
	if len(configIDs) > 0 {
		if _, err = tx.ConfigRevision.Delete().Where(configrevision.TeamID(teamID), configrevision.ConfigIDIn(configIDs...)).Exec(ctx); err != nil {
			return err
		}
	}
	if _, err = tx.TeamConfig.Delete().Where(teamconfig.TeamID(teamID), teamconfig.KindNEQ(teamconfig.KindModel), teamconfig.BuiltinIsNil()).Exec(ctx); err != nil {
		return err
	}
	packages, err := tx.PluginPackage.Query().Where(pluginpackage.TeamID(teamID)).All(ctx)
	if err != nil {
		return err
	}
	if _, err = tx.PluginPackage.Delete().Where(pluginpackage.TeamID(teamID)).Exec(ctx); err != nil {
		return err
	}

	artifactIDs, err := tx.Artifact.Query().Where(artifact.TeamID(teamID)).IDs(ctx)
	if err != nil {
		return err
	}
	objects, err := deleteArtifacts(ctx, tx.Client(), teamID, artifactIDs)
	if err != nil {
		return err
	}
	knowledgeDigests, err := deleteKnowledge(ctx, tx.Client(), teamID)
	if err != nil {
		return err
	}
	for _, digest := range knowledgeDigests {
		objects = append(objects, artifactObject{team: teamID, digest: digest, kind: knowledgeObjects})
	}

	local := *s
	local.DB = tx.Client()
	for _, c := range configs {
		created, err := tx.TeamConfig.Create().SetID(c.id).SetTeamID(teamID).SetKind(teamconfig.Kind(c.input.Kind)).
			SetName(c.input.Name).SetData(c.input.Canonical()).SetVersion(seed.Version).Save(ctx)
		if err != nil {
			return err
		}
		if err := recordRevision(ctx, tx.Client(), created, ownerID, "", "Official seed", "system"); err != nil {
			return err
		}
	}
	for _, c := range configs {
		if err := local.checkReferences(ctx, teamID, &c.input); err != nil {
			return err
		}
	}
	for _, space := range seed.Spaces {
		if _, err := tx.KnowledgeSpace.Create().SetID(space.ID).SetTeamID(teamID).SetName(space.Name).
			SetReading(knowledgespace.ReadingTeam).SetCreatedBy(ownerID).Save(ctx); err != nil {
			return err
		}
		for _, document := range space.Documents {
			at := s.now()
			if _, err := tx.KnowledgeDocument.Create().SetID(document.ID).SetTeamID(teamID).SetSpaceID(space.ID).
				SetFolderID("").SetTitle(document.Title).SetCurrentVersion(seed.Version).SetUpdatedAt(at).Save(ctx); err != nil {
				return err
			}
			if err := tx.KnowledgeVersion.Create().SetDocumentID(document.ID).SetNumber(seed.Version).SetAuthorID(ownerID).
				SetSource(knowledgeversion.SourceConsole).SetNote("Official seed").SetText(document.Text).SetCreatedAt(at).Exec(ctx); err != nil {
				return err
			}
		}
	}
	for _, a := range artifacts {
		at := s.now()
		created, err := tx.Artifact.Create().SetID(a.id).SetTeamID(teamID).SetOwnerID(ownerID).SetKind(artifact.Kind(a.kind)).
			SetTitle(a.title).SetSharing(artifact.SharingTeam).SetCurrentVersion(seed.Version).SetUpdatedAt(at).Save(ctx)
		if err != nil {
			return err
		}
		version, err := tx.ArtifactVersion.Create().SetArtifactID(created.ID).SetNumber(seed.Version).SetAuthorID(ownerID).
			SetNote("Official seed").SetSize(int64(len(a.content))).SetCreatedAt(at).Save(ctx)
		if err != nil {
			return err
		}
		entry, contentType := artifactEntry(a.kind)
		if err := tx.ArtifactFile.Create().SetVersionID(version.ID).SetTeamID(teamID).SetPath(entry).
			SetContentType(contentType).SetSize(int64(len(a.content))).SetDigest(a.digest).Exec(ctx); err != nil {
			return err
		}
	}
	// Increment in the same transaction as the content replacement. Writes
	// admitted at the previous generation now fail their commit fence.
	if err := tx.Team.UpdateOneID(teamID).AddContentGeneration(1).Exec(ctx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	s.forgetStored(context.WithoutCancel(ctx), packages, objects)
	return nil
}

func prepareSeed(seed edition.TeamSeed) ([]preparedConfig, []preparedArtifact, error) {
	if seed.Version < 1 {
		return nil, nil, fmt.Errorf("seed version must be positive")
	}
	ids := map[string]bool{}
	unique := func(id string) error {
		if !seedID.MatchString(id) || len(id) > 32 || ids[id] {
			return fmt.Errorf("invalid or duplicate seed id %q", id)
		}
		ids[id] = true
		return nil
	}
	configs := make([]preparedConfig, 0, len(seed.Configs))
	for _, c := range seed.Configs {
		if err := unique(c.ID); err != nil {
			return nil, nil, err
		}
		if c.Kind != "preset" && c.Kind != "plugin" {
			return nil, nil, fmt.Errorf("seed configuration %s is not a preset or plugin", c.ID)
		}
		input := wire.ConfigInput{Kind: c.Kind, Name: c.Name, Data: c.Data}
		if err := input.Validate(); err != nil {
			return nil, nil, err
		}
		if input.Plugin != nil && input.Plugin.PackageID != "" {
			return nil, nil, fmt.Errorf("seed plugin packages are not supported")
		}
		configs = append(configs, preparedConfig{id: c.ID, input: input})
	}
	for _, space := range seed.Spaces {
		if err := unique(space.ID); err != nil {
			return nil, nil, err
		}
		if err := seedName(space.Name, 80); err != nil {
			return nil, nil, err
		}
		for _, document := range space.Documents {
			if err := unique(document.ID); err != nil {
				return nil, nil, err
			}
			if err := seedName(document.Title, 120); err != nil {
				return nil, nil, err
			}
			if !utf8.ValidString(document.Text) || len(document.Text) > 1<<20 {
				return nil, nil, fmt.Errorf("invalid seed document text")
			}
		}
	}
	artifacts := make([]preparedArtifact, 0, len(seed.Artifacts))
	for _, a := range seed.Artifacts {
		if err := unique(a.ID); err != nil {
			return nil, nil, err
		}
		if a.Kind != "html" && a.Kind != "svg" || len(a.Content) == 0 || len(a.Content) > 5<<20 {
			return nil, nil, fmt.Errorf("invalid seed artifact %s", a.ID)
		}
		if err := seedName(a.Title, 120); err != nil {
			return nil, nil, err
		}
		sum := sha256.Sum256(a.Content)
		digest := base64.RawURLEncoding.EncodeToString(sum[:24])
		artifacts = append(artifacts, preparedArtifact{id: a.ID, kind: a.Kind, title: strings.TrimSpace(a.Title), digest: digest, content: a.Content})
	}
	return configs, artifacts, nil
}

func seedName(value string, max int) error {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > max || strings.ContainsAny(value, "/\\") {
		return fmt.Errorf("invalid seed name")
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("invalid seed name")
		}
	}
	return nil
}

func artifactEntry(kind string) (string, string) {
	if kind == "svg" {
		return "index.svg", "image/svg+xml"
	}
	return "index.html", "text/html; charset=utf-8"
}
