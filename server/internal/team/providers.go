package team

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamprovider"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// ListProviders is a team's providers, for its admin. Never a key.
func (s *Service) ListProviders(ctx context.Context, userID, teamID string) ([]ProviderView, error) {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.TeamProvider.Query().Where(teamprovider.TeamID(admin.TeamID)).Order(ent.Asc(teamprovider.FieldName)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ProviderView, 0, len(rows))
	for _, r := range rows {
		out = append(out, providerView(r))
	}
	return out, nil
}

func (s *Service) provider(ctx context.Context, teamID, providerID string) (*ent.TeamProvider, error) {
	p, err := s.DB.TeamProvider.Query().Where(teamprovider.ID(providerID), teamprovider.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return p, err
}

// UpdateProvider moves a provider or replaces its key. Its name stays: team
// models refer to it.
func (s *Service) UpdateProvider(ctx context.Context, userID, teamID, providerID string, in wire.ProviderUpdate) (ProviderView, error) {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return ProviderView{}, err
	}
	p, err := s.provider(ctx, admin.TeamID, providerID)
	if err != nil {
		return ProviderView{}, err
	}
	if p == nil {
		return ProviderView{}, wire.E(http.StatusNotFound, wire.ProviderNotConfigured)
	}
	u, _ := url.Parse(in.BaseURL)
	if err := s.Network.Check(ctx, u); err != nil {
		return ProviderView{}, err
	}
	update := p.Update().SetBaseURL(in.BaseURL)
	if in.APIKey != nil {
		update.SetKeyCipher(s.Keys.Seal(admin.TeamID, p.Name, *in.APIKey))
	}
	p, err = update.Save(ctx)
	if err != nil {
		return ProviderView{}, err
	}
	return providerView(p), nil
}

// DeleteProvider removes a provider no team model or preset still calls.
func (s *Service) DeleteProvider(ctx context.Context, userID, teamID, providerID string) error {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return err
	}
	p, err := s.provider(ctx, admin.TeamID, providerID)
	if err != nil || p == nil {
		return err
	}
	callers, err := s.DB.TeamConfig.Query().
		Where(teamconfig.TeamID(admin.TeamID), teamconfig.KindIn(teamconfig.KindModel, teamconfig.KindPreset)).All(ctx)
	if err != nil {
		return err
	}
	for _, c := range callers {
		var route struct {
			Provider *string `json:"provider"`
		}
		if json.Unmarshal(c.Data, &route) == nil && route.Provider != nil && *route.Provider == p.Name {
			return wire.E(http.StatusConflict, "provider_in_use")
		}
	}
	_, err = s.DB.TeamProvider.Delete().Where(teamprovider.ID(p.ID), teamprovider.TeamID(admin.TeamID)).Exec(ctx)
	return err
}

// Catalog is GET /api/teams/:teamId/model-catalog: one provider's models.
type Catalog struct {
	Provider string         `json:"provider"`
	Models   []CatalogModel `json:"models"`
}

// CatalogModel is one model a provider lists. A limit the provider does not
// report stays absent, never a guessed capability.
type CatalogModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextWindow *int64 `json:"contextWindow,omitempty"`
	MaxTokens     *int64 `json:"maxTokens,omitempty"`
}

type catalogItem struct {
	ID                  string  `json:"id"`
	DisplayName         *string `json:"display_name"`
	ContextLength       *int64  `json:"context_length"`
	ContextWindow       *int64  `json:"context_window"`
	MaxOutputTokens     *int64  `json:"max_output_tokens"`
	MaxCompletionTokens *int64  `json:"max_completion_tokens"`
	Limit               *struct {
		Context *int64 `json:"context"`
		Output  *int64 `json:"output"`
	} `json:"limit"`
}

func limitOK(v *int64) bool { return v == nil || (*v > 0 && *v <= 10_000_000) }

func (c catalogItem) valid() bool {
	ok := utf8.RuneCountInString(c.ID) >= 1 && utf8.RuneCountInString(c.ID) <= 100 && (c.DisplayName == nil || utf8.RuneCountInString(*c.DisplayName) <= 200) &&
		limitOK(c.ContextLength) && limitOK(c.ContextWindow) && limitOK(c.MaxOutputTokens) && limitOK(c.MaxCompletionTokens)
	if c.Limit != nil {
		ok = ok && limitOK(c.Limit.Context) && limitOK(c.Limit.Output)
	}
	return ok
}

func firstOf(vs ...*int64) *int64 {
	for _, v := range vs {
		if v != nil {
			return v
		}
	}
	return nil
}

// ModelCatalog reads one provider's /models, for an admin choosing team
// models: 15 seconds, a megabyte, and the address rule as for every call.
func (s *Service) ModelCatalog(ctx context.Context, client *http.Client, userID, teamID, provider string) (Catalog, error) {
	admin, err := s.RequireMembership(ctx, userID, teamID, true)
	if err != nil {
		return Catalog{}, err
	}
	base, key, err := s.Route(ctx, admin.TeamID, provider)
	if err != nil {
		return Catalog{}, err
	}
	unavailable := wire.E(http.StatusBadGateway, wire.UpstreamUnavailable)
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return Catalog{}, unavailable
	}
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := client.Do(req)
	if err != nil {
		return Catalog{}, unavailable
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20+1))
	if err != nil || res.StatusCode < 200 || res.StatusCode > 299 || len(body) > 1<<20 {
		return Catalog{}, unavailable
	}
	var list struct {
		Data []catalogItem `json:"data"`
	}
	if json.Unmarshal(body, &list) != nil || list.Data == nil || len(list.Data) > 2000 {
		return Catalog{}, unavailable
	}
	out := Catalog{Provider: provider, Models: []CatalogModel{}}
	index := map[string]int{}
	for _, m := range list.Data {
		if !m.valid() {
			return Catalog{}, unavailable
		}
		name := m.ID
		if m.DisplayName != nil {
			name = *m.DisplayName
		}
		var lc, lo *int64
		if m.Limit != nil {
			lc, lo = m.Limit.Context, m.Limit.Output
		}
		model := CatalogModel{ID: m.ID, Name: name, ContextWindow: firstOf(m.ContextLength, m.ContextWindow, lc), MaxTokens: firstOf(m.MaxOutputTokens, m.MaxCompletionTokens, lo)}
		// A listed id twice keeps its first place and its last details.
		if i, seen := index[m.ID]; seen {
			out.Models[i] = model
			continue
		}
		index[m.ID] = len(out.Models)
		out.Models = append(out.Models, model)
	}
	return out, nil
}

// Route is a team provider's base URL, checked against the address rule,
// and its key; provider_not_configured when the team has none by that name.
func (s *Service) Route(ctx context.Context, teamID, name string) (string, string, error) {
	p, err := s.DB.TeamProvider.Query().Where(teamprovider.TeamID(teamID), teamprovider.Name(name)).Only(ctx)
	if ent.IsNotFound(err) {
		return "", "", wire.E(http.StatusServiceUnavailable, wire.ProviderNotConfigured)
	}
	if err != nil {
		return "", "", err
	}
	u, err := url.Parse(p.BaseURL)
	if err != nil {
		return "", "", wire.E(http.StatusBadRequest, wire.ProviderAddressRefused)
	}
	if err := s.Network.Check(ctx, u); err != nil {
		return "", "", err
	}
	key, err := s.Keys.Open(teamID, p.Name, p.KeyCipher)
	if err != nil {
		return "", "", err
	}
	return strings.TrimSuffix(u.String(), "/"), key, nil
}
