package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Metadata is a transient form suggestion. No lookup identity or upstream data
// is written to team configuration, rates, or a local catalog.
type metadataModel struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Provider         string            `json:"provider"`
	ContextWindow    *int64            `json:"contextWindow,omitempty"`
	MaxTokens        *int64            `json:"maxTokens,omitempty"`
	Vision           *bool             `json:"vision,omitempty"`
	OutputModalities []string          `json:"outputModalities,omitempty"`
	Prices           map[string]string `json:"prices"`
}

type metadataLookup struct {
	Source   string `json:"source"`
	Provider string `json:"provider"`
	Query    string `json:"query"`
	Pricing  bool   `json:"pricing"`
}

func (s *Server) lookupModelMetadata(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if _, err := s.Team.RequireMembership(r.Context(), c.user.ID, r.PathValue("teamId"), true); err != nil {
		return err
	}
	var in metadataLookup
	if err := decode(r, &in); err != nil {
		return err
	}
	in.Provider, in.Query = strings.TrimSpace(in.Provider), strings.TrimSpace(in.Query)
	if (in.Source != "models_dev" && in.Source != "openrouter") || in.Query == "" || len(in.Query) > 200 || len(in.Provider) > 100 || (in.Source == "models_dev" && in.Provider == "") {
		var issues wire.Issues
		issues.Add("A source, provider and model query")
		return issues.Err()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	models, err := readMetadata(ctx, s.Gateway.Client, in)
	if err != nil {
		return wire.E(http.StatusBadGateway, wire.ModelMetadataUnavailable)
	}
	noStore(w)
	result := map[string]any{"models": models}
	if in.Pricing && len(models) > 0 {
		if fx, date := metadataExchangeRate(ctx, s.Gateway.Client); fx != "" {
			result["usdToCny"], result["exchangeDate"] = fx, date
		}
	}
	writeJSON(w, http.StatusOK, result)
	return nil
}

func readMetadata(ctx context.Context, client *http.Client, in metadataLookup) ([]metadataModel, error) {
	address := "https://models.dev/api.json"
	if in.Source == "openrouter" {
		address = "https://openrouter.ai/api/v1/models"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DSH-Teamwork/1.0")
	req.Header.Set("Cache-Control", "no-cache, no-store")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, wire.E(http.StatusBadGateway, wire.ModelMetadataUnavailable)
	}
	const maxSize = 32 << 20
	body, err := io.ReadAll(io.LimitReader(res.Body, maxSize+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxSize {
		return nil, wire.E(http.StatusBadGateway, wire.ModelMetadataUnavailable)
	}
	var models []metadataModel
	if in.Source == "openrouter" {
		models, err = openRouterMetadata(body)
	} else {
		models, err = modelsDevMetadata(body, in.Provider)
	}
	if err != nil {
		return nil, err
	}
	query := strings.ToLower(in.Query)
	matches := make([]metadataModel, 0)
	for _, m := range models {
		if strings.Contains(strings.ToLower(m.ID), query) || strings.Contains(strings.ToLower(m.Name), query) {
			matches = append(matches, m)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := strings.ToLower(matches[i].ID) == query, strings.ToLower(matches[j].ID) == query
		if a != b {
			return a
		}
		return matches[i].ID < matches[j].ID
	})
	if len(matches) > 50 {
		matches = matches[:50]
	}
	return matches, nil
}

type metadataLimits struct {
	Context *int64 `json:"context"`
	Output  *int64 `json:"output"`
}
type metadataModalities struct {
	Input  []string `json:"input"`
	Output []string `json:"output"`
}

func modelLimits(n *int64) *int64 {
	if n == nil || *n < 1 || *n > 10000000 {
		return nil
	}
	return n
}

func visionOf(input []string) *bool {
	if input == nil {
		return nil
	}
	v := false
	for _, m := range input {
		if m == "image" || strings.HasPrefix(m, "image/") {
			v = true
		}
	}
	return &v
}

// Both sources publish USD prices; normalize text rates to USD/million tokens
// using decimal arithmetic. Missing and malformed rates remain absent, not zero.
var metadataDecimal = regexp.MustCompile(`^[0-9]{1,12}(?:\.[0-9]{1,18})?(?:[eE][+-]?[0-9]{1,2})?$`)

func metadataPrice(raw json.RawMessage, multiplier int64) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	value := strings.Trim(string(raw), "\"")
	if !metadataDecimal.MatchString(value) {
		return ""
	}
	n, ok := new(big.Rat).SetString(value)
	if !ok || n.Sign() < 0 {
		return ""
	}
	n.Mul(n, big.NewRat(multiplier, 1))
	if n.Cmp(big.NewRat(1000000000, 1)) > 0 {
		return ""
	}
	price := n.FloatString(12)
	if n.Sign() > 0 && price == "0.000000000000" {
		return "0.000000000001"
	}
	return price
}

// The catalog belongs to a third party: only the requested provider is decoded,
// and an entry whose shape is unexpected is skipped rather than failing the lookup.
func modelsDevMetadata(body []byte, provider string) ([]metadataModel, error) {
	var catalog map[string]json.RawMessage
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	var entry struct {
		Models map[string]json.RawMessage `json:"models"`
	}
	if raw, ok := catalog[provider]; !ok || json.Unmarshal(raw, &entry) != nil {
		return []metadataModel{}, nil
	}
	models := make([]metadataModel, 0, len(entry.Models))
	for id, raw := range entry.Models {
		var m struct {
			ID         string                     `json:"id"`
			Name       string                     `json:"name"`
			Limit      metadataLimits             `json:"limit"`
			Modalities metadataModalities         `json:"modalities"`
			Cost       map[string]json.RawMessage `json:"cost"`
		}
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		prices := map[string]string{}
		for key, upstream := range map[string]string{"input": "input", "output": "output", "cacheRead": "cache_read", "cacheWrite": "cache_write"} {
			if p := metadataPrice(m.Cost[upstream], 1); p != "" {
				prices[key] = p
			}
		}
		// The provider catalog also has a structured text-cost representation.
		var text map[string]struct {
			Price json.RawMessage            `json:"price"`
			Cache map[string]json.RawMessage `json:"cache"`
		}
		if raw := m.Cost["text"]; len(raw) > 0 && json.Unmarshal(raw, &text) == nil {
			for _, key := range []string{"input", "output"} {
				if p := metadataPrice(text[key].Price, 1); p != "" {
					prices[key] = p
				}
			}
			for key, upstream := range map[string]string{"cacheRead": "read", "cacheWrite": "write"} {
				if p := metadataPrice(text["input"].Cache[upstream], 1); p != "" {
					prices[key] = p
				}
			}
		}
		if m.ID != "" {
			id = m.ID
		}
		models = append(models, metadataModel{ID: id, Name: m.Name, Provider: provider, ContextWindow: modelLimits(m.Limit.Context), MaxTokens: modelLimits(m.Limit.Output), Vision: visionOf(m.Modalities.Input), OutputModalities: m.Modalities.Output, Prices: prices})
	}
	return models, nil
}

func openRouterMetadata(body []byte) ([]metadataModel, error) {
	var catalog struct {
		Data []struct {
			ID           string `json:"id"`
			Name         string `json:"name"`
			Context      *int64 `json:"context_length"`
			Architecture struct {
				Input  []string `json:"input_modalities"`
				Output []string `json:"output_modalities"`
			} `json:"architecture"`
			TopProvider struct {
				Output *int64 `json:"max_completion_tokens"`
			} `json:"top_provider"`
			Pricing map[string]json.RawMessage `json:"pricing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, err
	}
	models := make([]metadataModel, 0, len(catalog.Data))
	for _, m := range catalog.Data {
		prices := map[string]string{}
		for key, upstream := range map[string]string{"input": "prompt", "output": "completion", "cacheRead": "input_cache_read", "cacheWrite": "input_cache_write"} {
			if p := metadataPrice(m.Pricing[upstream], 1000000); p != "" {
				prices[key] = p
			}
		}
		models = append(models, metadataModel{ID: m.ID, Name: m.Name, Provider: "openrouter", ContextWindow: modelLimits(m.Context), MaxTokens: modelLimits(m.TopProvider.Output), Vision: visionOf(m.Architecture.Input), OutputModalities: m.Architecture.Output, Prices: prices})
	}
	return models, nil
}

// FX is another live public lookup, never a guessed exchange rate. A failure
// leaves metadata usable and price application unavailable.
func metadataExchangeRate(ctx context.Context, client *http.Client) (string, string) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY", nil)
	if err != nil {
		return "", ""
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DSH-Teamwork/1.0")
	req.Header.Set("Cache-Control", "no-cache, no-store")
	res, err := client.Do(req)
	if err != nil {
		return "", ""
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", ""
	}
	var data struct {
		Base  string                     `json:"base"`
		Date  string                     `json:"date"`
		Rates map[string]json.RawMessage `json:"rates"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(&data) != nil || data.Base != "USD" {
		return "", ""
	}
	day, err := time.Parse("2006-01-02", data.Date)
	if err != nil || time.Since(day) > 10*24*time.Hour || time.Until(day) > 24*time.Hour {
		return "", ""
	}
	price := metadataPrice(data.Rates["CNY"], 1)
	n, ok := new(big.Rat).SetString(price)
	if !ok || n.Sign() <= 0 || n.Cmp(big.NewRat(100, 1)) > 0 {
		return "", ""
	}
	return price, data.Date
}
