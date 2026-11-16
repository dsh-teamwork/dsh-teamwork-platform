package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// ListConfigs is one team's configuration, for its console.
func (s *Service) ListConfigs(ctx context.Context, userID, teamID string) ([]ConfigView, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(m.TeamID)).All(ctx)
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
// presets change, as a provider stays while a model calls it.
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
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return err
	}
	target, err := s.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if target != nil && target.RouteOwner != "" {
		return wire.E(http.StatusForbidden, "config_owned")
	}
	if target != nil && target.Kind != teamconfig.KindPreset {
		presets, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(admin.TeamID), teamconfig.KindEQ(teamconfig.KindPreset)).All(ctx)
		if err != nil {
			return err
		}
		for _, p := range presets {
			var data wire.PresetData
			if json.Unmarshal(p.Data, &data) != nil {
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
	_, err = s.DB.TeamConfig.Delete().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Exec(ctx)
	return err
}
