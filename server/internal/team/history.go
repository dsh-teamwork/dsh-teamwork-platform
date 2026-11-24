package team

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func (s *Service) History(ctx context.Context, userID, teamID, configID, kind, author string, from, to *time.Time, offset int) ([]RevisionView, error) {
	if _, err := s.RequireMembership(ctx, userID, teamID, false); err != nil {
		return nil, err
	}
	q := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID))
	if configID != "" {
		q.Where(configrevision.ConfigID(configID))
	}
	if kind != "" {
		if kind != "preset" && kind != "plugin" && kind != "model" {
			return nil, wire.E(400, "invalid_request")
		}
		q.Where(configrevision.KindEQ(configrevision.Kind(kind)))
	}
	if author != "" {
		q.Where(configrevision.AuthorID(author))
	}
	if from != nil {
		q.Where(configrevision.CreatedAtGTE(*from))
	}
	if to != nil {
		q.Where(configrevision.CreatedAtLT(*to))
	}
	rows, err := q.Order(ent.Desc(configrevision.FieldCreatedAt), ent.Desc(configrevision.FieldID)).Offset(offset).Limit(50).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]RevisionView, 0, len(rows))
	for _, r := range rows {
		out = append(out, revisionView(r))
	}
	return out, nil
}
func (s *Service) historical(ctx context.Context, userID, teamID, id string, admin bool) (*ent.ConfigRevision, error) {
	if _, err := s.RequireMembership(ctx, userID, teamID, admin); err != nil {
		return nil, err
	}
	row, err := s.DB.ConfigRevision.Query().Where(configrevision.ID(id), configrevision.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, wire.E(http.StatusNotFound, "revision_not_found")
	}
	return row, err
}
func (s *Service) RestoreRevision(ctx context.Context, userID, teamID, id string, base int, note string) (SubmissionView, error) {
	row, err := s.historical(ctx, userID, teamID, id, true)
	if err != nil {
		return SubmissionView{}, err
	}
	if row.Kind == configrevision.KindModel {
		return SubmissionView{}, wire.E(400, "invalid_request")
	}
	in := wire.ConfigInput{Kind: string(row.Kind), Name: row.Name, Data: row.Data}
	if err := in.Validate(); err != nil {
		return SubmissionView{}, err
	}
	if err := s.checkReferences(ctx, teamID, &in); err != nil {
		return SubmissionView{}, err
	}
	return s.SaveSubmission(ctx, userID, teamID, "", wire.SubmissionInput{Config: in, ConfigID: row.ConfigID, BaseVersion: base, Note: note})
}

// resolvePlugin retains exact dependency versions even after the live catalog advances.
func (s *Service) resolvePlugin(ctx context.Context, teamID, id, version string) (*wire.PluginData, string, error) {
	current, err := s.DB.TeamConfig.Query().Where(teamconfig.ID(id), teamconfig.TeamID(teamID), teamconfig.KindEQ(teamconfig.KindPlugin)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, "", err
	}
	var data wire.PluginData
	if current != nil && json.Unmarshal(current.Data, &data) == nil && data.Version == version {
		return &data, current.Name, nil
	}
	rows, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(id), configrevision.KindEQ(configrevision.KindPlugin)).Order(ent.Desc(configrevision.FieldVersion)).All(ctx)
	if err != nil {
		return nil, "", err
	}
	for _, row := range rows {
		if json.Unmarshal(row.Data, &data) == nil && data.Version == version {
			return &data, row.Name, nil
		}
	}
	return nil, "", wire.E(400, wire.PluginDependencyInvalid)
}

type BackupManifest struct {
	Format       int                 `json:"format"`
	Resource     RevisionView        `json:"resource"`
	Dependencies []PluginVersionView `json:"dependencies"`
	Packages     []PackageView       `json:"packages"`
}

func (s *Service) ExportRevision(ctx context.Context, userID, teamID, id string) (BackupManifest, []string, error) {
	row, err := s.historical(ctx, userID, teamID, id, true)
	if err != nil {
		return BackupManifest{}, nil, err
	}
	packageIDs := []string{}
	dependencies := []PluginVersionView{}
	metadata := []PackageView{}
	var preset wire.PresetData
	var plugin wire.PluginData
	if row.Kind == configrevision.KindPlugin {
		if err := json.Unmarshal(row.Data, &plugin); err != nil {
			return BackupManifest{}, nil, err
		}
		if plugin.PackageID != "" {
			packageIDs = append(packageIDs, plugin.PackageID)
		}
	}
	if row.Kind == configrevision.KindPreset {
		if err := json.Unmarshal(row.Data, &preset); err != nil {
			return BackupManifest{}, nil, err
		}
		for _, pin := range preset.PluginDependencies {
			data, name, err := s.resolvePlugin(ctx, teamID, pin.PluginConfigID, pin.Version)
			if err != nil {
				return BackupManifest{}, nil, err
			}
			dependencies = append(dependencies, PluginVersionView{ConfigID: pin.PluginConfigID, Name: name, Data: *data})
			if data.PackageID != "" {
				packageIDs = append(packageIDs, data.PackageID)
			}
		}
	}
	seen := map[string]bool{}
	unique := []string{}
	for _, packageID := range packageIDs {
		if seen[packageID] {
			continue
		}
		seen[packageID] = true
		pkg, err := s.Package(ctx, userID, teamID, packageID)
		if err != nil {
			return BackupManifest{}, nil, err
		}
		if err := s.checkPackage(ctx, teamID, &wire.PluginData{Package: pkg.Package, Version: pkg.Version, PackageID: pkg.ID, SHA256: pkg.Sha256}); err != nil {
			return BackupManifest{}, nil, err
		}
		metadata = append(metadata, packageView(pkg))
		unique = append(unique, packageID)
	}
	return BackupManifest{Format: 1, Resource: revisionView(row), Dependencies: dependencies, Packages: metadata}, unique, nil
}
