package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// ListConfigs is one team's configuration, for its console.
func (s *Service) ListConfigs(ctx context.Context, userID, teamID string) ([]ConfigView, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(m.TeamID), teamconfig.AssetArchived(false)).All(ctx)
	if err != nil {
		return nil, err
	}
	sortConfigs(rows)
	out := make([]ConfigView, 0, len(rows))
	for _, r := range rows {
		out = append(out, configView(r))
	}
	return out, nil
}

// UpdateConfig edits a configuration, naming the version it was read at; a
// stale one is config_conflict.
func (s *Service) UpdateConfig(ctx context.Context, userID, teamID, configID string, in wire.UpdateConfig) (ConfigView, error) {
	return s.publishDirect(ctx, userID, teamID, configID, in.Version, in.ConfigInput)
}

// DeleteConfig removes a configuration no preset of the team still uses: a
// model a preset references, or a plugin a preset pins, stays until those
// presets change, as a provider stays while a model calls it. An owned model
// goes the same way, and its edition hears ModelRemoved.
func (s *Service) DeleteConfig(ctx context.Context, userID, teamID, configID string) error {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	local := *s
	local.DB = tx.Client()
	if err := local.deleteConfig(ctx, userID, teamID, configID); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Service) deleteConfig(ctx context.Context, userID, teamID, configID string) error {
	admin, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return err
	}
	target, err := s.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if target != nil && target.AssetOwnerID != "" {
		if target.AssetOwnerID != userID {
			return wire.E(http.StatusForbidden, "config_owned")
		}
		return s.DB.TeamConfig.UpdateOneID(configID).SetAssetArchived(true).Exec(ctx)
	}
	if admin.Role != membership.RoleAdmin {
		return wire.E(http.StatusForbidden, "admin_required")
	}
	if target != nil && target.Kind != teamconfig.KindPreset {
		presets, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(admin.TeamID), teamconfig.KindEQ(teamconfig.KindPreset), teamconfig.AssetArchived(false)).All(ctx)
		if err != nil {
			return err
		}
		selected, err := s.selectedPresetData(ctx, teamID)
		if err != nil {
			return err
		}
		for _, preset := range presets {
			selected = append(selected, preset.Data)
		}
		for _, raw := range selected {
			var data wire.PresetData
			if json.Unmarshal(raw, &data) != nil {
				continue
			}
			if target.Kind == teamconfig.KindModel && data.ModelConfigID != nil && *data.ModelConfigID == configID {
				return wire.E(http.StatusConflict, "model_in_use")
			}
			for _, d := range data.PluginDependencies {
				if target.Kind == teamconfig.KindPlugin && d.PluginConfigID == configID {
					return wire.E(http.StatusConflict, "plugin_in_use")
				}
			}
		}
	}
	if target != nil {
		exists, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID), configrevision.Version(target.Version)).Exist(ctx)
		if err != nil {
			return err
		}
		if !exists {
			if err := recordRevision(ctx, s.DB, target, "", "", "Pre-deletion baseline", "legacy"); err != nil {
				return err
			}
		}
	}
	if _, err := s.DB.TeamConfig.Delete().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Exec(ctx); err != nil {
		return err
	}
	// An owned model's route is its edition's: it forgets it, in this transaction.
	if target != nil && target.RouteOwner != "" {
		return s.changed(ctx, s.DB, edition.TeamChange{Kind: edition.ModelRemoved, TeamID: admin.TeamID, UserID: userID, ActorID: userID, ConfigID: configID})
	}
	return nil
}
