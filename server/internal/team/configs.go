package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
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
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return ConfigView{}, err
	}
	// A configuration keeps its kind: a model a preset references must not
	// become a plugin, which would also take it past the in-use checks.
	current, err := s.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return ConfigView{}, err
	}
	if current != nil && string(current.Kind) != in.Kind {
		var is wire.Issues
		is.Add("A configuration's kind does not change", "kind")
		return ConfigView{}, is.Err()
	}
	if err := s.checkReferences(ctx, admin.TeamID, &in.ConfigInput); err != nil {
		return ConfigView{}, err
	}
	changed, err := s.DB.TeamConfig.Update().
		Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID), teamconfig.Version(in.Version)).
		SetKind(teamconfig.Kind(in.Kind)).SetName(in.Name).SetData(in.Canonical()).AddVersion(1).Save(ctx)
	if err != nil {
		return ConfigView{}, conflict(err, wire.ConfigExists)
	}
	if changed == 0 {
		return ConfigView{}, wire.E(http.StatusConflict, "config_conflict")
	}
	c, err := s.DB.TeamConfig.Get(ctx, configID)
	if err != nil {
		return ConfigView{}, err
	}
	return configView(c), nil
}

// DeleteConfig removes a configuration no preset of the team still uses: a
// model a preset references, or a plugin a preset pins, stays until those
// presets change, as a provider stays while a model calls it.
func (s *Service) DeleteConfig(ctx context.Context, userID, teamID, configID string) error {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return err
	}
	target, err := s.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
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
	_, err = s.DB.TeamConfig.Delete().Where(teamconfig.ID(configID), teamconfig.TeamID(admin.TeamID)).Exec(ctx)
	return err
}
