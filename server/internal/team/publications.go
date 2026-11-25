package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetselection"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pluginpackage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func recordRevision(ctx context.Context, db *ent.Client, c *ent.TeamConfig, author, reviewer, note, source string) error {
	return db.ConfigRevision.Create().SetTeamID(c.TeamID).SetConfigID(c.ID).SetVersion(c.Version).SetKind(configrevision.Kind(c.Kind)).SetName(c.Name).SetData(c.Data).SetAuthorID(author).SetReviewerID(reviewer).SetNote(note).SetSource(configrevision.Source(source)).SetBuiltin(builtinName(c.Builtin)).Exec(ctx)
}

// publish is called only inside a transaction, after membership has been checked.
// The versioned live write and immutable history commit together.
func (s *Service) publish(ctx context.Context, teamID, configID string, base int, in wire.ConfigInput, author, note, assetOwner string, reactivate bool) (*ent.TeamConfig, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	if assetOwner != "" {
		if err := validateMemberPreset(in.Preset); err != nil {
			return nil, err
		}
	}
	if err := s.checkReferences(ctx, teamID, &in); err != nil {
		return nil, err
	}
	var current *ent.TeamConfig
	var err error
	if configID != "" {
		current, err = s.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(teamID)).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
	}
	version := 1
	restoredBuiltin := ""
	if current != nil {
		if current.RouteOwner != "" || (current.AssetArchived && (!reactivate || !current.AssetOwnerWithdrawn)) || (current.AssetOwnerID != "" && current.AssetOwnerID != assetOwner) {
			return nil, wire.E(http.StatusForbidden, "config_owned")
		}
		if string(current.Kind) != in.Kind {
			var issues wire.Issues
			issues.Add("A configuration keeps its kind", "kind")
			return nil, issues.Err()
		}
		if in.Plugin != nil {
			var old wire.PluginData
			if json.Unmarshal(current.Data, &old) == nil && old.Package == in.Plugin.Package && old.Version == in.Plugin.Version && (old.PackageID != in.Plugin.PackageID || old.SHA256 != in.Plugin.SHA256) {
				return nil, wire.E(http.StatusConflict, "package_version_exists")
			}
		}
		if current.Version != base {
			return nil, wire.E(http.StatusConflict, "config_conflict")
		}
		exists, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID), configrevision.Version(base)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if !exists {
			if err := recordRevision(ctx, s.DB, current, "", "", "Imported baseline", "legacy"); err != nil {
				return nil, err
			}
		}
		n, err := s.DB.TeamConfig.Update().Where(teamconfig.ID(configID), teamconfig.TeamID(teamID), teamconfig.Version(base), teamconfig.AssetArchived(reactivate), teamconfig.AssetOwnerWithdrawn(reactivate)).SetAssetArchived(false).SetAssetOwnerWithdrawn(false).SetName(in.Name).SetData(in.Canonical()).AddVersion(1).Save(ctx)
		if err != nil {
			return nil, conflict(err, wire.ConfigExists)
		}
		if n != 1 {
			return nil, wire.E(http.StatusConflict, "config_conflict")
		}
		current, err = s.DB.TeamConfig.Get(ctx, configID)
		if err != nil {
			return nil, err
		}
	} else {
		if base != 0 {
			return nil, wire.E(http.StatusConflict, "config_conflict")
		}
		if configID != "" {
			last, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID)).Order(ent.Desc(configrevision.FieldVersion)).First(ctx)
			if err != nil && !ent.IsNotFound(err) {
				return nil, err
			}
			if last != nil {
				if string(last.Kind) != in.Kind {
					return nil, wire.E(http.StatusConflict, "config_conflict")
				}
				version = last.Version + 1
				restoredBuiltin = last.Builtin
			}
		}
		create := s.DB.TeamConfig.Create().SetTeamID(teamID).SetKind(teamconfig.Kind(in.Kind)).SetName(in.Name).SetData(in.Canonical()).SetVersion(version)
		if assetOwner != "" {
			create.SetAssetOwnerID(assetOwner)
		}
		if restoredBuiltin != "" {
			create.SetBuiltin(restoredBuiltin)
		}
		if configID != "" {
			create.SetID(configID)
		}
		current, err = create.Save(ctx)
		if err != nil {
			return nil, conflict(err, wire.ConfigExists)
		}
	}
	if in.Plugin != nil && in.Plugin.PackageID != "" {
		if _, err := s.DB.PluginPackage.Update().Where(pluginpackage.ID(in.Plugin.PackageID), pluginpackage.TeamID(teamID)).SetPublished(true).Save(ctx); err != nil {
			return nil, err
		}
	}
	if err := recordRevision(ctx, s.DB, current, author, "", note, "direct"); err != nil {
		return nil, err
	}
	return current, nil
}

func (s *Service) publishDirect(ctx context.Context, userID, teamID, configID string, base int, in wire.ConfigInput) (ConfigView, error) {
	if err := in.Validate(); err != nil {
		return ConfigView{}, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return ConfigView{}, err
	}
	defer tx.Rollback()
	scoped := *s
	scoped.DB = tx.Client()
	member, err := scoped.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return ConfigView{}, err
	}
	admin := member.Role == membership.RoleAdmin
	var owner string
	switch {
	case configID != "":
		current, err := scoped.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.ID(configID)).Only(ctx)
		if ent.IsNotFound(err) {
			return ConfigView{}, wire.E(http.StatusConflict, "config_conflict")
		}
		if err != nil {
			return ConfigView{}, err
		}
		if current.AssetOwnerID == userID {
			owner = userID
		} else if !admin || current.AssetOwnerID != "" {
			return ConfigView{}, wire.E(http.StatusForbidden, "config_owned")
		}
	case in.Kind != "model" && (!admin || in.MemberAsset):
		owner = userID
	case !admin:
		return ConfigView{}, wire.E(http.StatusForbidden, "admin_required")
	}
	if owner != "" && in.Plugin != nil && in.Plugin.PackageID != "" {
		pkg, err := scoped.Package(ctx, userID, teamID, in.Plugin.PackageID)
		if err != nil {
			return ConfigView{}, err
		}
		if !pkg.Published && pkg.AuthorID != userID {
			return ConfigView{}, wire.E(http.StatusNotFound, "package_not_found")
		}
	}
	newAsset := owner != "" && configID == ""
	reactivate := false
	if newAsset {
		archived, err := scoped.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.AssetOwnerID(owner),
			teamconfig.KindEQ(teamconfig.Kind(in.Kind)), teamconfig.Name(in.Name), teamconfig.AssetArchived(true)).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return ConfigView{}, err
		}
		if archived != nil {
			if !archived.AssetOwnerWithdrawn {
				return ConfigView{}, wire.E(http.StatusConflict, "asset_restore_forbidden")
			}
			configID, base, reactivate = archived.ID, archived.Version, true
		}
	}
	c, err := scoped.publish(ctx, teamID, configID, base, in, userID, "", owner, reactivate)
	if err != nil {
		return ConfigView{}, err
	}
	if newAsset {
		// The author has what they share on their own DSH, at every later version too.
		if err := scoped.savePersonalChoice(ctx, teamID, userID, c.ID, assetselection.ModeLatest, 0); err != nil {
			return ConfigView{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return ConfigView{}, err
	}
	return configView(c), nil
}

// RevisionView never includes provider keys or authentication material.
type RevisionView struct {
	ID         string          `json:"id"`
	ConfigID   string          `json:"configId"`
	Kind       string          `json:"kind"`
	Name       string          `json:"name"`
	Data       json.RawMessage `json:"data"`
	Version    int             `json:"version"`
	AuthorID   string          `json:"authorId"`
	ReviewerID string          `json:"reviewerId"`
	Note       string          `json:"note"`
	Source     string          `json:"source"`
	CreatedAt  string          `json:"createdAt"`
}

func revisionView(r *ent.ConfigRevision) RevisionView {
	return RevisionView{r.ID, r.ConfigID, string(r.Kind), r.Name, r.Data, r.Version, r.AuthorID, r.ReviewerID, r.Note, string(r.Source), Time(r.CreatedAt)}
}

func validateMemberPreset(preset *wire.PresetData) error {
	if preset != nil && (preset.Provider != nil || preset.Model != nil) {
		var issues wire.Issues
		issues.Add("Select a team model or inherit the session model", "data", "modelConfigId")
		return issues.Err()
	}
	return nil
}
