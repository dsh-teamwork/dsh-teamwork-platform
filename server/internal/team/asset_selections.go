package team

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetselection"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type AssetChoiceInput struct {
	Version  int    `json:"version"`
	Disabled bool   `json:"disabled"`
	Name     string `json:"name"`
	Revision int    `json:"revision"`
}

type AssetChoice struct {
	Version         int    `json:"version"`
	Disabled        bool   `json:"disabled"`
	Name            string `json:"name"`
	Revision        int    `json:"revision"`
	AdoptedVersions []int  `json:"adoptedVersions,omitempty"`
}

func (s *Service) SelectAsset(ctx context.Context, userID, teamID, configID string, teamDefault bool, choice AssetChoiceInput) error {
	choice.Name = strings.TrimSpace(choice.Name)
	if choice.Version < 0 || choice.Revision < 0 || utf8.RuneCountInString(choice.Name) > 120 ||
		(choice.Disabled && (teamDefault || choice.Version != 0)) || (!teamDefault && choice.Name != "") {
		return wire.E(http.StatusBadRequest, "invalid_request")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	local := *s
	local.DB = tx.Client()
	if _, err := local.RequireMembership(ctx, userID, teamID, teamDefault); err != nil {
		return err
	}
	config, err := local.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.ID(configID), teamconfig.AssetOwnerIDNEQ("")).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(http.StatusNotFound, "config_not_found")
	}
	if err != nil {
		return err
	}
	var current *ent.AssetSelection
	if teamDefault {
		current, err = local.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.ConfigID(configID), assetselection.UserID("")).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return err
		}
	}
	if choice.Version != 0 {
		if config.AssetArchived {
			var allowed bool
			if teamDefault {
				allowed = current != nil && containsVersion(adoptedVersions(current.History), choice.Version)
			} else {
				allowed, err = local.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.ConfigID(configID), assetselection.UserID(userID), assetselection.Version(choice.Version)).Exist(ctx)
				if err != nil {
					return err
				}
			}
			if !allowed {
				return wire.E(http.StatusConflict, "config_conflict")
			}
		}
		revision, err := local.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID), configrevision.Version(choice.Version)).Only(ctx)
		if ent.IsNotFound(err) {
			return wire.E(http.StatusNotFound, "revision_not_found")
		}
		if err != nil {
			return err
		}
		in := wire.ConfigInput{Kind: string(revision.Kind), Name: revision.Name, Data: revision.Data}
		if err := in.Validate(); err != nil {
			return err
		}
		if err := validateMemberPreset(in.Preset); err != nil {
			return err
		}
		if err := local.checkReferences(ctx, teamID, &in); err != nil {
			return err
		}
	}
	if teamDefault {
		err = local.saveAssetDefault(ctx, userID, teamID, configID, current, choice)
	} else {
		err = local.savePersonalAssetChoice(ctx, teamID, userID, configID, choice)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

type assetDefaultEvent struct {
	Version int    `json:"version"`
	Name    string `json:"name"`
	ActorID string `json:"actorId"`
	At      string `json:"at"`
}

func (s *Service) saveAssetDefault(ctx context.Context, userID, teamID, configID string, current *ent.AssetSelection, choice AssetChoiceInput) error {
	var history []json.RawMessage
	revision := 0
	if current != nil {
		revision = current.Revision
		history = current.History
		if current.Version == choice.Version && current.Name == choice.Name {
			return nil
		}
	}
	if revision != choice.Revision {
		return wire.E(http.StatusConflict, "config_conflict")
	}
	event, err := json.Marshal(assetDefaultEvent{Version: choice.Version, Name: choice.Name, ActorID: userID, At: Time(s.now())})
	if err != nil {
		return err
	}
	history = append(history, event)
	if current == nil {
		err := s.DB.AssetSelection.Create().SetTeamID(teamID).SetConfigID(configID).SetUserID("").
			SetVersion(choice.Version).SetName(choice.Name).SetHistory(history).SetRevision(1).Exec(ctx)
		return conflict(err, "config_conflict")
	}
	n, err := s.DB.AssetSelection.Update().Where(assetselection.ID(current.ID), assetselection.Revision(revision)).
		SetVersion(choice.Version).SetName(choice.Name).SetHistory(history).AddRevision(1).Save(ctx)
	if err == nil && n != 1 {
		return wire.E(http.StatusConflict, "config_conflict")
	}
	return err
}

func containsVersion(versions []int, version int) bool {
	for _, adopted := range versions {
		if adopted == version {
			return true
		}
	}
	return false
}

func adoptedVersions(history []json.RawMessage) []int {
	var versions []int
	for _, raw := range history {
		var event assetDefaultEvent
		if json.Unmarshal(raw, &event) == nil && event.Version > 0 && !containsVersion(versions, event.Version) {
			versions = append(versions, event.Version)
		}
	}
	return versions
}

type AssetChoices struct {
	Personal map[string]AssetChoice `json:"personal"`
	Defaults map[string]AssetChoice `json:"defaults"`
	Archived []ConfigView           `json:"archived"`
}

func (s *Service) AssetChoices(ctx context.Context, userID, teamID string) (AssetChoices, error) {
	member, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return AssetChoices{}, err
	}
	result, err := s.assetChoices(ctx, userID, teamID)
	if err != nil {
		return result, err
	}
	result.Archived = []ConfigView{}
	var ids []string
	for id, choice := range result.Personal {
		if choice.Version > 0 {
			ids = append(ids, id)
		}
	}
	for id, choice := range result.Defaults {
		if choice.Version > 0 || member.Role == membership.RoleAdmin {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return result, nil
	}
	configs, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.AssetArchived(true), teamconfig.IDIn(ids...)).All(ctx)
	if err != nil {
		return result, err
	}
	sortConfigs(configs)
	for _, config := range configs {
		result.Archived = append(result.Archived, configView(config))
	}
	return result, nil
}

func (s *Service) assetChoices(ctx context.Context, userID, teamID string) (AssetChoices, error) {
	result := AssetChoices{Personal: map[string]AssetChoice{}, Defaults: map[string]AssetChoice{}}
	rows, err := s.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.UserIDIn("", userID)).All(ctx)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		if row.UserID == "" {
			result.Defaults[row.ConfigID] = AssetChoice{Version: row.Version, Name: row.Name, Revision: row.Revision, AdoptedVersions: adoptedVersions(row.History)}
		} else {
			result.Personal[row.ConfigID] = AssetChoice{Version: row.Version, Disabled: row.Disabled}
		}
	}
	return result, nil
}

func (s *Service) effectiveConfigs(ctx context.Context, team *ent.Team, userID string) ([]*ent.TeamConfig, error) {
	choices, err := s.assetChoices(ctx, userID, team.ID)
	if err != nil {
		return nil, err
	}
	configs := make([]*ent.TeamConfig, 0, len(team.Edges.Configs))
	for _, config := range team.Edges.Configs {
		if config.AssetOwnerID == "" {
			configs = append(configs, config)
			continue
		}
		pinned, err := s.effectiveAsset(ctx, config, choices)
		if err != nil {
			return nil, err
		}
		if pinned != nil {
			configs = append(configs, pinned)
		}
	}
	return configs, nil
}

// EffectiveAsset resolves the same selected revision for the gateway and sync.
// The caller must already have verified membership in the asset's team.
func (s *Service) EffectiveAsset(ctx context.Context, userID string, config *ent.TeamConfig) (*ent.TeamConfig, error) {
	choices, err := s.assetChoices(ctx, userID, config.TeamID)
	if err != nil {
		return nil, err
	}
	return s.effectiveAsset(ctx, config, choices)
}

func (s *Service) effectiveAsset(ctx context.Context, config *ent.TeamConfig, choices AssetChoices) (*ent.TeamConfig, error) {
	choice := choices.Personal[config.ID]
	if choice.Version == 0 && !choice.Disabled {
		choice = choices.Defaults[config.ID]
	}
	if choice.Version == 0 {
		return nil, nil
	}
	pinned := *config
	if choice.Version != config.Version {
		row, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(config.TeamID), configrevision.ConfigID(config.ID), configrevision.Version(choice.Version)).Only(ctx)
		if err != nil {
			return nil, err
		}
		pinned.Data, pinned.Name, pinned.Version, pinned.UpdatedAt = row.Data, row.Name, row.Version, row.CreatedAt
	}
	if choice.Name != "" {
		pinned.Name = choice.Name
	}
	return &pinned, nil
}

// selectedPresetData includes old revisions that still pin a team model or
// provider. The catalog head alone does not describe those dependencies.
func (s *Service) selectedPresetData(ctx context.Context, teamID string) ([]json.RawMessage, error) {
	selections, err := s.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.VersionGT(0)).All(ctx)
	if err != nil || len(selections) == 0 {
		return nil, err
	}
	versions := make(map[string]map[int]bool)
	for _, selection := range selections {
		if versions[selection.ConfigID] == nil {
			versions[selection.ConfigID] = map[int]bool{}
		}
		versions[selection.ConfigID][selection.Version] = true
	}
	ids := make([]string, 0, len(versions))
	for id := range versions {
		ids = append(ids, id)
	}
	rows, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.KindEQ(configrevision.KindPreset), configrevision.ConfigIDIn(ids...)).All(ctx)
	if err != nil {
		return nil, err
	}
	var data []json.RawMessage
	for _, row := range rows {
		if versions[row.ConfigID][row.Version] {
			data = append(data, row.Data)
		}
	}
	return data, nil
}

func (s *Service) savePersonalAssetChoice(ctx context.Context, teamID, userID, configID string, choice AssetChoiceInput) error {
	return s.DB.AssetSelection.Create().SetTeamID(teamID).SetUserID(userID).SetConfigID(configID).
		SetVersion(choice.Version).SetDisabled(choice.Disabled).
		OnConflictColumns(assetselection.FieldTeamID, assetselection.FieldUserID, assetselection.FieldConfigID).
		UpdateNewValues().Exec(ctx)
}
