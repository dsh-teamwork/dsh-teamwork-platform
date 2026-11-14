package wire

import (
	"bytes"
	"encoding/json"
	"net/url"
	"regexp"
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
	ProviderAddressRefused  = "provider_address_refused"
	ProviderKeysUnavailable = "provider_keys_unavailable"
)

var semver = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$`)
var npmPackage = regexp.MustCompile(`^(?:@[a-z0-9-]+/)?[a-z0-9][a-z0-9._-]*$`)

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

// ModelData is a provider's model, addressed the way the provider names it.
type ModelData struct {
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	ContextWindow *int64 `json:"contextWindow,omitempty"`
	MaxTokens     *int64 `json:"maxTokens,omitempty"`
}

func (m *ModelData) validate(is *Issues) {
	name(is, &m.Provider, "data", "provider")
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
	Provider           *string            `json:"provider,omitempty"`
	Model              *string            `json:"model,omitempty"`
	ContextWindow      *int64             `json:"contextWindow,omitempty"`
	MaxTokens          *int64             `json:"maxTokens,omitempty"`
	ModelConfigID      *string            `json:"modelConfigId,omitempty"`
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
	if (p.ModelConfigID != nil && ownRoute) || (p.ModelConfigID == nil && (p.Provider == nil || p.Model == nil)) {
		is.Add("A preset references a team model or names its own provider and model, not both.")
	}
}

// PluginData pins an npm package at one exact version.
type PluginData struct {
	Package       string   `json:"package"`
	Version       string   `json:"version"`
	ProvidesTools []string `json:"providesTools"`
	Description   string   `json:"description"`
}

func (p *PluginData) validate(is *Issues) {
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
	name(&is, &c.Name, "name")
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
