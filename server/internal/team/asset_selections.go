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

// PersonalChoice is how one member uses a preset or plugin: follow its latest
// version, pin one, or remove it from their DSH. "default" drops the member's
// row, so the team's recommendation applies again.
type PersonalChoice struct {
	Mode    string `json:"mode"`
	Version int    `json:"version,omitempty"`
}

// TeamDefaultInput is the version an administrator recommends to the whole
// team, under an optional display name; Revision guards concurrent edits.
type TeamDefaultInput struct {
	Version  int    `json:"version"`
	Name     string `json:"name"`
	Revision int    `json:"revision"`
}

// TeamDefault is a recommendation as the API answers it.
type TeamDefault struct {
	Version         int    `json:"version"`
	Name            string `json:"name"`
	Revision        int    `json:"revision"`
	AdoptedVersions []int  `json:"adoptedVersions,omitempty"`
}

const followDefault = "default"

// ChooseAsset records how one member uses an asset. A team's own preset or
// plugin is on every member's DSH, so it can only be removed and brought back.
func (s *Service) ChooseAsset(ctx context.Context, userID, teamID, configID string, in PersonalChoice) error {
	mode := assetselection.Mode(in.Mode)
	switch {
	case in.Mode == followDefault || mode == assetselection.ModeLatest || mode == assetselection.ModeRemoved:
		if in.Version != 0 {
			return wire.E(http.StatusBadRequest, "invalid_request")
		}
	case mode == assetselection.ModePinned:
		if in.Version < 1 {
			return wire.E(http.StatusBadRequest, "invalid_request")
		}
	default:
		return wire.E(http.StatusBadRequest, "invalid_request")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	local := *s
	local.DB = tx.Client()
	if _, err := local.RequireMembership(ctx, userID, teamID, false); err != nil {
		return err
	}
	config, err := local.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.ID(configID), teamconfig.KindIn(teamconfig.KindPreset, teamconfig.KindPlugin)).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(http.StatusNotFound, "config_not_found")
	}
	if err != nil {
		return err
	}
	// The team assistant is how a member reaches Teamwork from DSH; it stays.
	if config.AssetOwnerID == "" && (in.Mode != followDefault && mode != assetselection.ModeRemoved || builtinName(config.Builtin) != "") {
		return wire.E(http.StatusBadRequest, "invalid_request")
	}
	current, err := local.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.ConfigID(configID), assetselection.UserID(userID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	// A withdrawn asset is not added again; whoever already uses it keeps it.
	if config.AssetArchived && (mode == assetselection.ModeLatest || mode == assetselection.ModePinned) &&
		(current == nil || current.Mode != mode || current.Version != in.Version) {
		return wire.E(http.StatusConflict, "config_conflict")
	}
	if mode == assetselection.ModePinned {
		if err := local.checkRevision(ctx, teamID, configID, in.Version); err != nil {
			return err
		}
	}
	if in.Mode == followDefault {
		_, err = local.DB.AssetSelection.Delete().Where(assetselection.TeamID(teamID), assetselection.ConfigID(configID), assetselection.UserID(userID)).Exec(ctx)
	} else {
		err = local.savePersonalChoice(ctx, teamID, userID, configID, mode, in.Version)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

// SetAssetDefault recommends a member's asset to the whole team at one version,
// or withdraws the recommendation with version 0.
func (s *Service) SetAssetDefault(ctx context.Context, userID, teamID, configID string, in TeamDefaultInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Version < 0 || in.Revision < 0 || utf8.RuneCountInString(in.Name) > 120 {
		return wire.E(http.StatusBadRequest, "invalid_request")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	local := *s
	local.DB = tx.Client()
	if _, err := local.RequireMembership(ctx, userID, teamID, true); err != nil {
		return err
	}
	config, err := local.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.ID(configID), teamconfig.AssetOwnerIDNEQ("")).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(http.StatusNotFound, "config_not_found")
	}
	if err != nil {
		return err
	}
	current, err := local.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.ConfigID(configID), assetselection.UserID("")).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if in.Version != 0 {
		if config.AssetArchived && (current == nil || !containsVersion(adoptedVersions(current.History), in.Version)) {
			return wire.E(http.StatusConflict, "config_conflict")
		}
		if err := local.checkRevision(ctx, teamID, configID, in.Version); err != nil {
			return err
		}
	}
	if err := local.saveAssetDefault(ctx, userID, teamID, configID, current, in); err != nil {
		return err
	}
	return tx.Commit()
}

// checkRevision holds a pinned version to what publishing it would require
// today: a member preset routes through a team model and its references exist.
func (s *Service) checkRevision(ctx context.Context, teamID, configID string, version int) error {
	revision, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID), configrevision.Version(version)).Only(ctx)
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
	return s.checkReferences(ctx, teamID, &in)
}

type assetDefaultEvent struct {
	Version int    `json:"version"`
	Name    string `json:"name"`
	ActorID string `json:"actorId"`
	At      string `json:"at"`
}

func (s *Service) saveAssetDefault(ctx context.Context, userID, teamID, configID string, current *ent.AssetSelection, choice TeamDefaultInput) error {
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

// AssetChoices is what the catalog needs beside the configurations: the
// caller's own choices, the team's recommendations, how many members have each
// asset on their DSH, and the withdrawn assets the caller still sees.
type AssetChoices struct {
	Personal map[string]PersonalChoice `json:"personal"`
	Defaults map[string]TeamDefault    `json:"defaults"`
	Users    map[string]int            `json:"users"`
	Archived []ConfigView              `json:"archived"`
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
	if result.Users, err = s.assetUsers(ctx, teamID, result.Defaults); err != nil {
		return result, err
	}
	result.Archived = []ConfigView{}
	var ids []string
	for id, choice := range result.Personal {
		if choice.Mode != string(assetselection.ModeRemoved) {
			ids = append(ids, id)
		}
	}
	for id, choice := range result.Defaults {
		if choice.Version > 0 || member.Role == membership.RoleAdmin {
			ids = append(ids, id)
		}
	}
	if member.Role == membership.RoleAdmin {
		// An administrator can bring back nothing, but sees what was withdrawn.
		owned, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.AssetArchived(true)).IDs(ctx)
		if err != nil {
			return result, err
		}
		ids = append(ids, owned...)
	} else {
		owned, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.AssetArchived(true), teamconfig.AssetOwnerID(userID)).IDs(ctx)
		if err != nil {
			return result, err
		}
		ids = append(ids, owned...)
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

// assetUsers counts, for each preset and plugin, the members it reaches: every
// member but those who removed it when the team recommends it or owns it, and
// otherwise those who added it.
func (s *Service) assetUsers(ctx context.Context, teamID string, defaults map[string]TeamDefault) (map[string]int, error) {
	members, err := s.DB.Membership.Query().Where(membership.TeamID(teamID)).Count(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.UserIDNEQ("")).All(ctx)
	if err != nil {
		return nil, err
	}
	using, removed := map[string]int{}, map[string]int{}
	for _, row := range rows {
		if row.Mode == assetselection.ModeRemoved {
			removed[row.ConfigID]++
		} else {
			using[row.ConfigID]++
		}
	}
	configs, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(teamID), teamconfig.KindIn(teamconfig.KindPreset, teamconfig.KindPlugin)).All(ctx)
	if err != nil {
		return nil, err
	}
	users := make(map[string]int, len(configs))
	for _, config := range configs {
		if config.AssetOwnerID == "" || defaults[config.ID].Version > 0 {
			users[config.ID] = members - removed[config.ID]
		} else {
			users[config.ID] = using[config.ID]
		}
	}
	return users, nil
}

func (s *Service) assetChoices(ctx context.Context, userID, teamID string) (AssetChoices, error) {
	result := AssetChoices{Personal: map[string]PersonalChoice{}, Defaults: map[string]TeamDefault{}}
	rows, err := s.DB.AssetSelection.Query().Where(assetselection.TeamID(teamID), assetselection.UserIDIn("", userID)).All(ctx)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		if row.UserID == "" {
			result.Defaults[row.ConfigID] = TeamDefault{Version: row.Version, Name: row.Name, Revision: row.Revision, AdoptedVersions: adoptedVersions(row.History)}
		} else {
			result.Personal[row.ConfigID] = PersonalChoice{Mode: string(row.Mode), Version: row.Version}
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
			if choices.Personal[config.ID].Mode != string(assetselection.ModeRemoved) {
				configs = append(configs, config)
			}
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

// effectiveAsset is the member's own choice where they made one, and else the
// team's recommendation under its display name; nil when neither puts it on
// their DSH.
func (s *Service) effectiveAsset(ctx context.Context, config *ent.TeamConfig, choices AssetChoices) (*ent.TeamConfig, error) {
	version, name := 0, ""
	if personal, ok := choices.Personal[config.ID]; ok {
		switch assetselection.Mode(personal.Mode) {
		case assetselection.ModeLatest:
			version = config.Version
		case assetselection.ModePinned:
			version = personal.Version
		}
	} else {
		version, name = choices.Defaults[config.ID].Version, choices.Defaults[config.ID].Name
	}
	if version == 0 {
		return nil, nil
	}
	pinned := *config
	if version != config.Version {
		row, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(config.TeamID), configrevision.ConfigID(config.ID), configrevision.Version(version)).Only(ctx)
		if err != nil {
			return nil, err
		}
		pinned.Data, pinned.Name, pinned.Version, pinned.UpdatedAt = row.Data, row.Name, row.Version, row.CreatedAt
	}
	if name != "" {
		pinned.Name = name
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

func (s *Service) savePersonalChoice(ctx context.Context, teamID, userID, configID string, mode assetselection.Mode, version int) error {
	return s.DB.AssetSelection.Create().SetTeamID(teamID).SetUserID(userID).SetConfigID(configID).
		SetMode(mode).SetVersion(version).
		OnConflictColumns(assetselection.FieldTeamID, assetselection.FieldUserID, assetselection.FieldConfigID).
		UpdateNewValues().Exec(ctx)
}
