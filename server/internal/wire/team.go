package wire

import (
	"bytes"
	"encoding/json"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// The codes the team API refuses with (TEAM_ERRORS).
const (
	TeamNotFound            = "team_not_found"
	AdminRequired           = "admin_required"
	ConfigExists            = "config_exists"
	ModelNotFound           = "model_not_found"
	PluginDependencyInvalid = "plugin_dependency_invalid"
	MaxTokensExceedsContext = "max_tokens_exceeds_context"
	ModelForbidden          = "model_forbidden"
	ProviderNotConfigured   = "provider_not_configured"
	UpstreamUnavailable     = "upstream_unavailable"
	UpstreamRateLimited     = "upstream_rate_limited"
	PayloadTooLarge         = "payload_too_large"
	ProviderExists          = "provider_exists"
	// Why an address is refused (internal/team/network.go): a private or
	// loopback address this instance does not allow, plain http to a public
	// one, or a host that does not resolve.
	ProviderAddressPrivate    = "provider_address_private"
	ProviderAddressPlainHTTP  = "provider_address_plain_http"
	ProviderAddressUnresolved = "provider_address_unresolved"
	// ProviderKeyRejected is the provider answering 401 or 403 to its key.
	ProviderKeyRejected     = "provider_key_rejected"
	ProviderKeysUnavailable = "provider_keys_unavailable"
	// ModelMetadataUnavailable is a public model catalog that could not be read.
	ModelMetadataUnavailable = "model_metadata_unavailable"
)

var semver = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$`)
var npmPackage = regexp.MustCompile(`^(?:@[a-z0-9-]+/)?[a-z0-9][a-z0-9._-]*$`)

// avatarID is the shape of a preset avatar's id. The library itself is the
// clients' (packages/shared/src/avatars.ts), and a client draws an id it does
// not know as a fallback, so the server checks only the shape.
var avatarID = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

func length(s string) int { return utf8.RuneCountInString(s) }

// name is the trimmed name rule: 1 to 100 characters.
func name(is *Issues, v *string, path ...any) {
	*v = strings.TrimSpace(*v)
	if length(*v) < 1 || length(*v) > 100 {
		is.Add("Between 1 and 100 characters", path...)
	}
}

func tokens(is *Issues, v *int64, path ...any) {
	if v != nil && (*v < 1 || *v > 10_000_000) {
		is.Add("A whole number from 1 to 10000000", path...)
	}
}

func maxLen(is *Issues, v string, n int, path ...any) {
	if length(v) > n {
		is.Add("Too long", path...)
	}
}

// CreateTeam is POST /api/teams.
type CreateTeam struct {
	Name string `json:"name"`
}

func (c *CreateTeam) Validate() error {
	var is Issues
	name(&is, &c.Name, "name")
	return is.Err()
}

// Provider is POST /api/teams/:teamId/providers. The key is write-only.
type Provider struct {
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

func (p *Provider) Validate() error {
	var is Issues
	name(&is, &p.Name, "name")
	if p.Name == HostedProvider {
		is.Add("Reserved for the service's own models", "name")
	}
	if !ValidBaseURL(p.BaseURL) {
		is.Add("An http or https URL with no credentials, query or fragment", "baseUrl")
	}
	p.APIKey = strings.TrimSpace(p.APIKey)
	if length(p.APIKey) < 1 || length(p.APIKey) > 4096 {
		is.Add("Between 1 and 4096 characters", "apiKey")
	}
	return is.Err()
}

// ProviderCheck is POST /api/teams/{teamId}/providers/check: an address and a
// key to read a model list with before either is saved.
type ProviderCheck struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

func (p *ProviderCheck) Validate() error {
	var is Issues
	if !ValidBaseURL(p.BaseURL) {
		is.Add("An http or https URL with no credentials, query or fragment", "baseUrl")
	}
	p.APIKey = strings.TrimSpace(p.APIKey)
	if length(p.APIKey) < 1 || length(p.APIKey) > 4096 {
		is.Add("Between 1 and 4096 characters", "apiKey")
	}
	return is.Err()
}

// ValidBaseURL is an OpenAI-compatible base URL with nothing hidden in it.
func ValidBaseURL(s string) bool {
	if len(s) > 500 {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" &&
		u.User == nil && u.RawQuery == "" && u.Fragment == "" && !strings.Contains(s, "?") && !strings.Contains(s, "#")
}

// HostedProvider is the provider every model an edition publishes names
// (edition.OwnedModel). Which edition owns it, and so funds its calls, is the
// configuration's route owner, never this string; no team provider may take
// the name, so a team's own models never read as one.
const HostedProvider = "hosted"

// ModelData is a provider's model, addressed the way the provider names it.
type ModelData struct {
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	ContextWindow *int64 `json:"contextWindow,omitempty"`
	MaxTokens     *int64 `json:"maxTokens,omitempty"`
	Vision        *bool  `json:"vision,omitempty"`
	// Offline is a hosted model its service has taken out of service: the
	// configuration stays, and comes back when the model does. Only that
	// service sets it (edition.OwnedModel); an admin's model never carries it.
	Offline bool `json:"offline,omitempty"`
}

func (m *ModelData) validate(is *Issues) {
	if m.Offline {
		is.Add("Only the service hosting a model marks it offline", "data", "offline")
	}
	name(is, &m.Provider, "data", "provider")
	if m.Provider == HostedProvider {
		is.Add("Only the service hosting a model names this provider", "data", "provider")
	}
	name(is, &m.Model, "data", "model")
	tokens(is, m.ContextWindow, "data", "contextWindow")
	tokens(is, m.MaxTokens, "data", "maxTokens")
}

// PluginDependency pins a team plugin at one version.
type PluginDependency struct {
	PluginConfigID string `json:"pluginConfigId"`
	Version        string `json:"version"`
}

// PresetData references a team model or names its own provider and model,
// never both.
type PresetData struct {
	InheritModel       bool               `json:"inheritModel,omitempty"`
	Provider           *string            `json:"provider,omitempty"`
	Model              *string            `json:"model,omitempty"`
	ContextWindow      *int64             `json:"contextWindow,omitempty"`
	MaxTokens          *int64             `json:"maxTokens,omitempty"`
	ModelConfigID      *string            `json:"modelConfigId,omitempty"`
	Avatar             string             `json:"avatar,omitempty"`
	Description        string             `json:"description"`
	Instructions       string             `json:"instructions"`
	OutputDescription  string             `json:"outputDescription"`
	PluginDependencies []PluginDependency `json:"pluginDependencies"`
	RequiredTools      []string           `json:"requiredTools"`
	OptionalTools      []string           `json:"optionalTools"`
	SystemPrompt       string             `json:"systemPrompt"`
}

func toolList(is *Issues, list []string, field string) []string {
	if len(list) > 50 {
		is.Add("At most 50", "data", field)
	}
	out := make([]string, 0, len(list))
	for i, t := range list {
		t = strings.TrimSpace(t)
		if length(t) < 1 || length(t) > 100 {
			is.Add("Between 1 and 100 characters", "data", field, i)
		}
		out = append(out, t)
	}
	return out
}

func (p *PresetData) validate(is *Issues) {
	if p.Provider != nil {
		name(is, p.Provider, "data", "provider")
	}
	if p.Model != nil {
		name(is, p.Model, "data", "model")
	}
	tokens(is, p.ContextWindow, "data", "contextWindow")
	tokens(is, p.MaxTokens, "data", "maxTokens")
	if p.ModelConfigID != nil && (length(*p.ModelConfigID) < 1 || length(*p.ModelConfigID) > 100) {
		is.Add("Between 1 and 100 characters", "data", "modelConfigId")
	}
	if p.Avatar != "" && !avatarID.MatchString(p.Avatar) {
		is.Add("A preset avatar's id", "data", "avatar")
	}
	maxLen(is, p.Description, 500, "data", "description")
	maxLen(is, p.Instructions, 4000, "data", "instructions")
	maxLen(is, p.OutputDescription, 2000, "data", "outputDescription")
	maxLen(is, p.SystemPrompt, 20_000, "data", "systemPrompt")
	if p.PluginDependencies == nil {
		p.PluginDependencies = []PluginDependency{}
	}
	if len(p.PluginDependencies) > 30 {
		is.Add("At most 30", "data", "pluginDependencies")
	}
	seen := map[string]bool{}
	for i, d := range p.PluginDependencies {
		if length(d.PluginConfigID) < 1 || length(d.PluginConfigID) > 100 {
			is.Add("Between 1 and 100 characters", "data", "pluginDependencies", i, "pluginConfigId")
		}
		if !semver.MatchString(d.Version) {
			is.Add("A semantic version", "data", "pluginDependencies", i, "version")
		}
		if seen[d.PluginConfigID] {
			is.Add("A plugin is listed twice.", "data", "pluginDependencies")
		}
		seen[d.PluginConfigID] = true
	}
	p.RequiredTools = toolList(is, p.RequiredTools, "requiredTools")
	p.OptionalTools = toolList(is, p.OptionalTools, "optionalTools")
	tools := map[string]bool{}
	for _, t := range append(append([]string{}, p.RequiredTools...), p.OptionalTools...) {
		if tools[t] {
			is.Add("A tool is listed twice.", "data", "requiredTools")
			break
		}
		tools[t] = true
	}
	ownRoute := p.Provider != nil || p.Model != nil || p.ContextWindow != nil || p.MaxTokens != nil
	if p.InheritModel && (p.ModelConfigID != nil || ownRoute) || !p.InheritModel && ((p.ModelConfigID != nil && ownRoute) || (p.ModelConfigID == nil && (p.Provider == nil || p.Model == nil))) {
		is.Add("A preset references a team model or names its own provider and model, not both.", "data")
	}
}

// PluginData pins an npm package at one exact version.
type PluginData struct {
	ArtifactID    string   `json:"artifactId,omitempty"`
	SHA256        string   `json:"sha256,omitempty"`
	Package       string   `json:"package"`
	Version       string   `json:"version"`
	ProvidesTools []string `json:"providesTools"`
	Description   string   `json:"description"`
}

func (p *PluginData) validate(is *Issues) {
	if (p.ArtifactID == "") != (p.SHA256 == "") || len(p.ArtifactID) > 32 || (p.SHA256 != "" && !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(p.SHA256)) {
		is.Add("An artifact and its SHA-256 digest are required together", "data", "artifactId")
	}
	if !npmPackage.MatchString(p.Package) {
		is.Add("An npm package name", "data", "package")
	}
	if !semver.MatchString(p.Version) {
		is.Add("A semantic version", "data", "version")
	}
	if p.ProvidesTools == nil {
		p.ProvidesTools = []string{}
	}
	if len(p.ProvidesTools) > 100 {
		is.Add("At most 100", "data", "providesTools")
	}
	for i, t := range p.ProvidesTools {
		p.ProvidesTools[i] = strings.TrimSpace(t)
		if length(p.ProvidesTools[i]) < 1 || length(p.ProvidesTools[i]) > 100 {
			is.Add("Between 1 and 100 characters", "data", "providesTools", i)
		}
	}
	maxLen(is, p.Description, 1000, "data", "description")
}

// ConfigInput is a configuration as an admin writes it: its kind, name and
// the kind's data. Data is checked strictly: an unknown field is refused.
type ConfigInput struct {
	Kind string          `json:"kind"`
	Name string          `json:"name"`
	Data json.RawMessage `json:"data"`

	Model  *ModelData  `json:"-"`
	Preset *PresetData `json:"-"`
	Plugin *PluginData `json:"-"`
}

// Validate parses Data for the kind and holds it to the kind's rules.
func (c *ConfigInput) Validate() error {
	var is Issues
	c.Name = strings.TrimSpace(c.Name)
	if length(c.Name) < 1 || length(c.Name) > 120 {
		is.Add("Between 1 and 120 characters", "name")
	}
	strict := func(v any) bool {
		dec := json.NewDecoder(bytes.NewReader(c.Data))
		dec.DisallowUnknownFields()
		if len(c.Data) == 0 || dec.Decode(v) != nil {
			is.Add("Invalid data for this kind", "data")
			return false
		}
		return true
	}
	switch c.Kind {
	case "model":
		c.Model = &ModelData{}
		if strict(c.Model) {
			c.Model.validate(&is)
		}
	case "preset":
		c.Preset = &PresetData{}
		if strict(c.Preset) {
			c.Preset.validate(&is)
		}
	case "plugin":
		c.Plugin = &PluginData{}
		if strict(c.Plugin) {
			c.Plugin.validate(&is)
		}
	default:
		is.Add("One of model, preset, plugin", "kind")
	}
	return is.Err()
}

// Canonical is the data as stored and answered: what the rules normalized,
// defaults filled in.
func (c *ConfigInput) Canonical() json.RawMessage {
	var v any
	switch {
	case c.Model != nil:
		v = c.Model
	case c.Preset != nil:
		v = c.Preset
	case c.Plugin != nil:
		v = c.Plugin
	}
	b, _ := json.Marshal(v)
	return b
}

// ProviderUpdate is PUT /api/teams/:teamId/providers/:id. The name stays,
// since team models refer to it; a key left out stays as it was.
type ProviderUpdate struct {
	BaseURL string  `json:"baseUrl"`
	APIKey  *string `json:"apiKey"`
}

func (p *ProviderUpdate) Validate() error {
	var is Issues
	if !ValidBaseURL(p.BaseURL) {
		is.Add("An http or https URL with no credentials, query or fragment", "baseUrl")
	}
	if p.APIKey != nil {
		*p.APIKey = strings.TrimSpace(*p.APIKey)
		if length(*p.APIKey) < 1 || length(*p.APIKey) > 4096 {
			is.Add("Between 1 and 4096 characters", "apiKey")
		}
	}
	return is.Err()
}

// UpdateConfig is PATCH /api/teams/:teamId/configs/:id: the whole
// configuration again, and the version it was read at.
type UpdateConfig struct {
	ConfigInput
	Version int `json:"version"`
}

func (u *UpdateConfig) Validate() error {
	err := u.ConfigInput.Validate()
	if u.Version < 1 {
		var is Issues
		if inv, ok := err.(*Invalid); ok {
			is = inv.Issues
		}
		is.Add("A positive whole number", "version")
		return is.Err()
	}
	return err
}

// AddMember is POST /api/teams/:teamId/members, where the instance holds
// passwords.
type AddMember struct {
	Email string `json:"email"`
}

func (a *AddMember) Validate() error {
	var is Issues
	email, ok := Email(a.Email)
	if !ok {
		is.Add("An email address", "email")
	}
	a.Email = email
	return is.Err()
}

// RedeemInvite is POST /api/invites/redeem.
type RedeemInvite struct {
	Token string `json:"token"`
}

func (r *RedeemInvite) Validate() error {
	var is Issues
	if len(r.Token) < 32 || len(r.Token) > 100 {
		is.Add("An invitation token", "token")
	}
	return is.Err()
}

// Locales are the interface languages (packages/shared/src/locales.ts).
var Locales = []string{"en", "zh-CN"}

// UpdateProfile is PATCH /api/profile: either field, a value or null.
type UpdateProfile struct {
	Name   Optional[string] `json:"name"`
	Locale Optional[string] `json:"locale"`
}

func (u *UpdateProfile) Validate() error {
	var is Issues
	if u.Name.Set && u.Name.Value != nil {
		*u.Name.Value = strings.TrimSpace(*u.Name.Value)
		if length(*u.Name.Value) < 1 || length(*u.Name.Value) > 80 {
			is.Add("Between 1 and 80 characters", "name")
		}
	}
	if u.Locale.Set && u.Locale.Value != nil && !IsLocale(*u.Locale.Value) {
		is.Add("One of en, zh-CN", "locale")
	}
	return is.Err()
}

// IsLocale is whether s is one of Locales.
func IsLocale(s string) bool {
	return slices.Contains(Locales, s)
}

// ChooseLocale is POST /api/locale.
type ChooseLocale struct {
	Locale string `json:"locale"`
}

func (c *ChooseLocale) Validate() error {
	var is Issues
	if !IsLocale(c.Locale) {
		is.Add("One of en, zh-CN", "locale")
	}
	return is.Err()
}

// Optional is a field that may be absent, null, or a value.
type Optional[T any] struct {
	Set   bool
	Value *T
}

func (o *Optional[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

// DeleteTeam is DELETE /api/teams/{teamId}: confirm is the team's name.
type DeleteTeam struct {
	Confirm string `json:"confirm"`
}

func (d *DeleteTeam) Validate() error {
	var is Issues
	if length(d.Confirm) < 1 || length(d.Confirm) > 320 {
		is.Add("The team's name", "confirm")
	}
	return is.Err()
}

// DeleteAccount is DELETE /api/profile: confirm is the account's email.
type DeleteAccount struct {
	Confirm string `json:"confirm"`
}

func (d *DeleteAccount) Validate() error {
	var is Issues
	if length(d.Confirm) < 1 || length(d.Confirm) > 320 {
		is.Add("The account's email", "confirm")
	}
	return is.Err()
}
