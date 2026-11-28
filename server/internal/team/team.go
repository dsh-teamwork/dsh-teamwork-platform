// Package team holds every team rule, written once for the API and the
// console (ADR 0013): a person may be in several teams, so every function
// that acts on a team takes its id from the caller and re-reads the
// membership of that one pair, user and team. A removed member is refused on
// their very next request, and an admin of one team is nobody in another.
package team

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/contentfence"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamprovider"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/objectstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Service is the team rules over one database.
type Service struct {
	DB      *ent.Client
	Objects objectstore.Store
	Keys    *Keys
	Network *Network
	Auth    *auth.Service
	// Passwords is whether the instance holds passwords (no SMTP), where an
	// admin creates members' accounts rather than inviting them.
	// ProtectedAccount prevents team administrators from controlling instance credentials.
	ProtectedAccount func(string) bool
	Passwords        bool
	Now              func() time.Time
	Changed          func(context.Context, *ent.Client, edition.TeamChange) error
	Content          *contentfence.Fence
	// AutoLeaveTeam is an edition's trial team: a person who creates or joins
	// any other team leaves it in the same transaction. Joining it and system
	// provisioning never trigger the rule.
	AutoLeaveTeam string
}

func (s *Service) changed(ctx context.Context, db *ent.Client, change edition.TeamChange) error {
	if err := s.autoLeave(ctx, db, change); err != nil {
		return err
	}
	if s.Changed == nil {
		return nil
	}
	return s.Changed(ctx, db, change)
}

func (s *Service) autoLeave(ctx context.Context, db *ent.Client, change edition.TeamChange) error {
	if s.AutoLeaveTeam == "" || change.TeamID == s.AutoLeaveTeam {
		return nil
	}
	if change.Kind != edition.TeamCreated && change.Kind != edition.MemberJoined {
		return nil
	}
	if change.Kind == edition.TeamCreated && change.System {
		return nil
	}
	return s.removeMembershipInTx(ctx, db, change.UserID, s.AutoLeaveTeam)
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Time is how the API writes a time: UTC, milliseconds, as JavaScript's
// toISOString does.
func Time(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// RequireMembership is the caller's membership in teamID; admin also requires
// the admin role there. A team the caller is not in is a 404, the same answer
// as one that does not exist, so a team id reveals nothing to an outsider.
func (s *Service) RequireMembership(ctx context.Context, userID, teamID string, admin bool) (*ent.Membership, error) {
	m, err := s.DB.Membership.Query().Where(membership.UserID(userID), membership.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, wire.E(http.StatusNotFound, wire.TeamNotFound)
	}
	if err != nil {
		return nil, err
	}
	if admin && m.Role != membership.RoleAdmin {
		return nil, wire.E(http.StatusForbidden, wire.AdminRequired)
	}
	return m, nil
}

// Created is POST /api/teams's answer.
type Created struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// CreateTeam makes a team; the caller is its admin. locale is the caller's
// language, which the team's built-in assistant is named in.
func (s *Service) CreateTeam(ctx context.Context, userID string, in wire.CreateTeam, locale string) (Created, error) {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return Created{}, err
	}
	defer tx.Rollback()
	created, err := s.createInTx(ctx, tx, userID, in, locale, false, "")
	if err != nil {
		return Created{}, err
	}
	return created, tx.Commit()
}

// createInTx is team creation's part of the caller's transaction. A system
// team creates its sign-in-less owner in the same transaction before this.
func (s *Service) createInTx(ctx context.Context, tx *ent.Tx, userID string, in wire.CreateTeam, locale string, system bool, id string) (Created, error) {
	create := tx.Team.Create().SetName(in.Name)
	if id != "" {
		create.SetID(id)
	}
	t, err := create.Save(ctx)
	if err != nil {
		return Created{}, err
	}
	if err := tx.Membership.Create().SetUserID(userID).SetTeamID(t.ID).SetRole(membership.RoleAdmin).Exec(ctx); err != nil {
		return Created{}, err
	}
	if err := provisionAssistant(ctx, tx.Client(), t.ID, t.Name, locale); err != nil {
		return Created{}, err
	}
	change := edition.TeamChange{Kind: edition.TeamCreated, TeamID: t.ID, UserID: userID, ActorID: userID, System: system}
	if err := s.changed(ctx, tx.Client(), change); err != nil {
		return Created{}, err
	}
	return Created{ID: t.ID, Name: t.Name}, nil
}

// ProviderView is a provider as an admin sees it: never the key.
type ProviderView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	BaseURL   string `json:"baseUrl"`
	UpdatedAt string `json:"updatedAt"`
}

func providerView(p *ent.TeamProvider) ProviderView {
	return ProviderView{ID: p.ID, Name: p.Name, BaseURL: p.BaseURL, UpdatedAt: Time(p.UpdatedAt)}
}

// CreateProvider adds a provider; its address must pass the network rule
// now, and on every call.
func (s *Service) CreateProvider(ctx context.Context, userID, teamID string, in wire.Provider) (ProviderView, error) {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return ProviderView{}, err
	}
	u, _ := url.Parse(in.BaseURL)
	if err := s.Network.Check(ctx, u); err != nil {
		return ProviderView{}, err
	}
	p, err := s.DB.TeamProvider.Create().SetTeamID(admin.TeamID).SetName(in.Name).SetBaseURL(in.BaseURL).
		SetKeyCipher(s.Keys.Seal(admin.TeamID, in.Name, in.APIKey)).Save(ctx)
	if ent.IsConstraintError(err) {
		return ProviderView{}, wire.E(http.StatusConflict, wire.ProviderExists)
	}
	if err != nil {
		return ProviderView{}, err
	}
	return providerView(p), nil
}

// ConfigView is a stored configuration as the API answers it.
type ConfigView struct {
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
	Name          string          `json:"name"`
	Data          json.RawMessage `json:"data"`
	Version       int             `json:"version"`
	UpdatedAt     string          `json:"updatedAt"`
	Owner         string          `json:"owner,omitempty"`
	AssetArchived bool            `json:"assetArchived,omitempty"`
	AssetOwnerID  string          `json:"assetOwnerId,omitempty"`
	Builtin       string          `json:"builtin,omitempty"`
}

func configView(c *ent.TeamConfig) ConfigView {
	return ConfigView{ID: c.ID, Kind: string(c.Kind), Name: c.Name, Data: c.Data, Version: c.Version, UpdatedAt: Time(c.UpdatedAt), Owner: c.RouteOwner, AssetOwnerID: c.AssetOwnerID, AssetArchived: c.AssetArchived, Builtin: builtinName(c.Builtin)}
}

var kindOrder = map[teamconfig.Kind]int{teamconfig.KindModel: 0, teamconfig.KindPreset: 1, teamconfig.KindPlugin: 2}

// sortConfigs orders by kind (model, preset, plugin) then name, the same on
// every dialect: a database's own collation and enum order differ.
func sortConfigs(cs []*ent.TeamConfig) {
	sort.SliceStable(cs, func(i, j int) bool {
		if kindOrder[cs[i].Kind] != kindOrder[cs[j].Kind] {
			return kindOrder[cs[i].Kind] < kindOrder[cs[j].Kind]
		}
		return cs[i].Name < cs[j].Name
	})
}

type PluginVersionView struct {
	ConfigID string          `json:"configId"`
	Name     string          `json:"name"`
	Data     wire.PluginData `json:"data"`
}

// TeamSnapshot is one team in the plugin's snapshot.
type TeamSnapshot struct {
	TeamID         string              `json:"teamId"`
	TeamName       string              `json:"teamName"`
	Role           string              `json:"role"`
	Configs        []ConfigView        `json:"configs"`
	PluginVersions []PluginVersionView `json:"pluginVersions"`
}

// Snapshot is GET /api/configs: every team the caller is in, the ones they
// joined first first, each with its configuration.
type Snapshot struct {
	Teams []TeamSnapshot `json:"teams"`
}

// ConfigSnapshot is what the plugin syncs.
// ConfigSnapshot is what a member's computer syncs; host is that computer's
// relay host, or "" when it is not known, which gets everything.
func (s *Service) ConfigSnapshot(ctx context.Context, userID, host string) (Snapshot, error) {
	ms, err := s.DB.Membership.Query().Where(membership.UserID(userID)).
		WithTeam(func(q *ent.TeamQuery) { q.WithConfigs() }).
		Order(ent.Asc(membership.FieldCreatedAt), ent.Asc(membership.FieldID)).All(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	out := Snapshot{Teams: make([]TeamSnapshot, 0, len(ms))}
	for _, m := range ms {
		t, err := s.teamSnapshot(ctx, m.Edges.Team, userID, host, string(m.Role))
		if err != nil {
			return Snapshot{}, err
		}
		out.Teams = append(out.Teams, t)
	}
	return out, nil
}

// teamSnapshot is one team's configurations and the plugin versions its
// presets pin; t carries its configs.
func (s *Service) teamSnapshot(ctx context.Context, t *ent.Team, userID, host, role string) (TeamSnapshot, error) {
	configs, err := s.effectiveConfigs(ctx, t, userID, host)
	if err != nil {
		return TeamSnapshot{}, err
	}
	sortConfigs(configs)
	views := make([]ConfigView, 0, len(configs))
	nameCounts := make(map[string]int, len(configs))
	for _, c := range configs {
		nameCounts[string(c.Kind)+"\x00"+c.Name]++
	}
	for _, c := range configs {
		view := configView(c)
		if c.AssetOwnerID != "" && nameCounts[string(c.Kind)+"\x00"+c.Name] > 1 {
			view.Name += " [" + c.ID + "]"
		}
		views = append(views, view)
	}
	pins := []PluginVersionView{}
	seen := map[string]bool{}
	for _, c := range configs {
		if c.Kind != teamconfig.KindPreset {
			continue
		}
		var preset wire.PresetData
		if json.Unmarshal(c.Data, &preset) != nil {
			continue
		}
		for _, pin := range preset.PluginDependencies {
			key := pin.PluginConfigID + "@" + pin.Version
			if seen[key] {
				continue
			}
			seen[key] = true
			data, name, err := s.resolvePlugin(ctx, t.ID, pin.PluginConfigID, pin.Version)
			if err != nil {
				return TeamSnapshot{}, err
			}
			pins = append(pins, PluginVersionView{ConfigID: pin.PluginConfigID, Name: name, Data: *data})
		}
	}
	return TeamSnapshot{TeamID: t.ID, TeamName: t.Name, Role: role, Configs: views, PluginVersions: pins}, nil
}

// checkReferences holds what a configuration names to the team: a provider
// it calls, a team model it references, a plugin it pins at its version.
func (s *Service) checkReferences(ctx context.Context, teamID string, in *wire.ConfigInput) error {
	if in.Plugin != nil {
		return s.checkPackage(ctx, teamID, in.Plugin)
	}
	var provider *string
	var ctxWin, maxTok *int64
	switch {
	case in.Model != nil:
		provider, ctxWin, maxTok = &in.Model.Provider, in.Model.ContextWindow, in.Model.MaxTokens
	case in.Preset != nil:
		provider, ctxWin, maxTok = in.Preset.Provider, in.Preset.ContextWindow, in.Preset.MaxTokens
	default:
		return nil
	}
	if ctxWin != nil && maxTok != nil && *maxTok > *ctxWin {
		return wire.E(http.StatusBadRequest, wire.MaxTokensExceedsContext)
	}
	if provider != nil {
		ok, err := s.DB.TeamProvider.Query().Where(teamprovider.TeamID(teamID), teamprovider.Name(*provider)).Exist(ctx)
		if err != nil {
			return err
		}
		if !ok {
			return wire.E(http.StatusBadRequest, wire.ProviderNotConfigured)
		}
	}
	if in.Preset == nil {
		return nil
	}
	if id := in.Preset.ModelConfigID; id != nil {
		ok, err := s.DB.TeamConfig.Query().Where(teamconfig.ID(*id), teamconfig.TeamID(teamID), teamconfig.KindEQ(teamconfig.KindModel)).Exist(ctx)
		if err != nil {
			return err
		}
		if !ok {
			return wire.E(http.StatusBadRequest, wire.ModelNotFound)
		}
	}
	for _, d := range in.Preset.PluginDependencies {
		if _, _, err := s.resolvePlugin(ctx, teamID, d.PluginConfigID, d.Version); err != nil {
			return err
		}
	}

	return nil
}

// CreateConfig publishes a configuration.
func (s *Service) CreateConfig(ctx context.Context, userID, teamID string, in wire.ConfigInput) (ConfigView, error) {
	return s.publishDirect(ctx, userID, teamID, "", 0, in)
}
