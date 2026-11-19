// Package modelmeta reads public model catalogues (OpenRouter's and
// Models.dev's) and the day's USD/CNY rate into form suggestions: names,
// limits and USD prices per million tokens. Nothing it reads is stored by
// this package; whoever applies a suggestion decides what to keep.
package modelmeta

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Model is one catalogue entry, as a suggestion.
type Model struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Provider         string            `json:"provider"`
	ContextWindow    *int64            `json:"contextWindow,omitempty"`
	MaxTokens        *int64            `json:"maxTokens,omitempty"`
	Vision           *bool             `json:"vision,omitempty"`
	OutputModalities []string          `json:"outputModalities,omitempty"`
	Prices           map[string]string `json:"prices"`
}

// Query searches one source: "openrouter", or "models_dev" within a provider
// it names (every provider, by exact id, when it names none it knows).
type Query struct {
	Source   string
	Provider string
	Query    string
}

var errUnavailable = errors.New("model catalogue unavailable")

func get(ctx context.Context, client *http.Client, address string) ([]byte, error) {
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
		return nil, errUnavailable
	}
	const maxSize = 32 << 20
	body, err := io.ReadAll(io.LimitReader(res.Body, maxSize+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxSize {
		return nil, errUnavailable
	}
	return body, nil
}

func Search(ctx context.Context, client *http.Client, in Query) ([]Model, error) {
	address := "https://models.dev/api.json"
	if in.Source == "openrouter" {
		address = "https://openrouter.ai/api/v1/models"
	}
	body, err := get(ctx, client, address)
	if err != nil {
		return nil, err
	}
	var models []Model
	everywhere := false
	if in.Source == "openrouter" {
		models, err = openRouterMetadata(body)
	} else {
		models, everywhere, err = modelsDevMetadata(body, in.Provider)
	}
	if err != nil {
		return nil, err
	}
	// Across every provider a substring would match half the catalog, so only
	// the exact model id counts there.
	query := strings.ToLower(in.Query)
	matches := make([]Model, 0)
	for _, m := range models {
		id := strings.ToLower(m.ID)
		if id == query || (!everywhere && (strings.Contains(id, query) || strings.Contains(strings.ToLower(m.Name), query))) {
			matches = append(matches, m)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := strings.ToLower(matches[i].ID) == query, strings.ToLower(matches[j].ID) == query
		if a != b {
			return a
		}
		if matches[i].ID != matches[j].ID {
			return matches[i].ID < matches[j].ID
		}
		return matches[i].Provider < matches[j].Provider
	})
	if len(matches) > 50 {
		matches = matches[:50]
	}
	return matches, nil
}

type limits struct {
	Context *int64 `json:"context"`
	Output  *int64 `json:"output"`
}
type modalities struct {
	Input  []string `json:"input"`
	Output []string `json:"output"`
}

func bounded(n *int64) *int64 {
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
var decimal = regexp.MustCompile(`^[0-9]{1,12}(?:\.[0-9]{1,18})?(?:[eE][+-]?[0-9]{1,2})?$`)

func price(raw json.RawMessage, multiplier int64) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	value := strings.Trim(string(raw), "\"")
	if !decimal.MatchString(value) {
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

// The catalog belongs to a third party: an entry whose shape is unexpected is
// skipped rather than failing the lookup. A provider the catalog names is the
// only one decoded; any other (a team's own proxy, say) decodes every provider,
// and the second result says so.
func modelsDevMetadata(body []byte, provider string) ([]Model, bool, error) {
	var catalog map[string]json.RawMessage
	if err := json.Unmarshal(body, &catalog); err != nil {
		return nil, false, err
	}
	names := []string{provider}
	everywhere := false
	if _, ok := catalog[provider]; !ok {
		everywhere, names = true, make([]string, 0, len(catalog))
		for name := range catalog {
			names = append(names, name)
		}
	}
	models := make([]Model, 0)
	for _, name := range names {
		models = append(models, modelsDevProvider(catalog[name], name)...)
	}
	return models, everywhere, nil
}

func modelsDevProvider(raw json.RawMessage, provider string) []Model {
	var entry struct {
		Models map[string]json.RawMessage `json:"models"`
	}
	if json.Unmarshal(raw, &entry) != nil {
		return nil
	}
	models := make([]Model, 0, len(entry.Models))
	for id, raw := range entry.Models {
		var m struct {
			ID         string                     `json:"id"`
			Name       string                     `json:"name"`
			Limit      limits                     `json:"limit"`
			Modalities modalities                 `json:"modalities"`
			Cost       map[string]json.RawMessage `json:"cost"`
		}
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		prices := map[string]string{}
		for key, upstream := range map[string]string{"input": "input", "output": "output", "cacheRead": "cache_read", "cacheWrite": "cache_write"} {
			if p := price(m.Cost[upstream], 1); p != "" {
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
				if p := price(text[key].Price, 1); p != "" {
					prices[key] = p
				}
			}
			for key, upstream := range map[string]string{"cacheRead": "read", "cacheWrite": "write"} {
				if p := price(text["input"].Cache[upstream], 1); p != "" {
					prices[key] = p
				}
			}
		}
		if m.ID != "" {
			id = m.ID
		}
		models = append(models, Model{ID: id, Name: m.Name, Provider: provider, ContextWindow: bounded(m.Limit.Context), MaxTokens: bounded(m.Limit.Output), Vision: visionOf(m.Modalities.Input), OutputModalities: m.Modalities.Output, Prices: prices})
	}
	return models
}

func openRouterMetadata(body []byte) ([]Model, error) {
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
	models := make([]Model, 0, len(catalog.Data))
	for _, m := range catalog.Data {
		prices := openRouterPrices(m.Pricing)
		models = append(models, Model{ID: m.ID, Name: m.Name, Provider: "openrouter", ContextWindow: bounded(m.Context), MaxTokens: bounded(m.TopProvider.Output), Vision: visionOf(m.Architecture.Input), OutputModalities: m.Architecture.Output, Prices: prices})
	}
	return models, nil
}

// FX is another live public lookup, never a guessed exchange rate. A failure
// leaves metadata usable and price application unavailable.
func ExchangeRate(ctx context.Context, client *http.Client) (string, string) {
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
	price := price(data.Rates["CNY"], 1)
	n, ok := new(big.Rat).SetString(price)
	if !ok || n.Sign() <= 0 || n.Cmp(big.NewRat(100, 1)) > 0 {
		return "", ""
	}
	return price, data.Date
}

// Endpoint is one upstream serving an OpenRouter model: Tag is the slug an
// OpenRouter request's provider.order takes ("deepinfra/fp8"), Provider its
// display name, and Prices its own USD per million tokens.
type Endpoint struct {
	Tag           string            `json:"tag"`
	Provider      string            `json:"provider"`
	Quantization  string            `json:"quantization,omitempty"`
	ContextWindow *int64            `json:"contextWindow,omitempty"`
	MaxTokens     *int64            `json:"maxTokens,omitempty"`
	Prices        map[string]string `json:"prices"`
}

var openRouterID = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._:-]{0,127}$`)

// Endpoints lists the upstreams OpenRouter routes one model to, each with the
// price it charges there; the model's own price is what it charges when free
// to choose.
func Endpoints(ctx context.Context, client *http.Client, id string) ([]Endpoint, error) {
	if !openRouterID.MatchString(id) {
		return nil, errUnavailable
	}
	author, slug, _ := strings.Cut(id, "/")
	body, err := get(ctx, client, "https://openrouter.ai/api/v1/models/"+url.PathEscape(author)+"/"+url.PathEscape(slug)+"/endpoints")
	if err != nil {
		return nil, err
	}
	var data struct {
		Data struct {
			Endpoints []struct {
				Tag          string                     `json:"tag"`
				Provider     string                     `json:"provider_name"`
				Quantization string                     `json:"quantization"`
				Context      *int64                     `json:"context_length"`
				Output       *int64                     `json:"max_completion_tokens"`
				Pricing      map[string]json.RawMessage `json:"pricing"`
			} `json:"endpoints"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	out := make([]Endpoint, 0, len(data.Data.Endpoints))
	for _, e := range data.Data.Endpoints {
		if e.Tag == "" {
			continue
		}
		out = append(out, Endpoint{Tag: e.Tag, Provider: e.Provider, Quantization: e.Quantization, ContextWindow: bounded(e.Context), MaxTokens: bounded(e.Output), Prices: openRouterPrices(e.Pricing)})
	}
	return out, nil
}

func openRouterPrices(pricing map[string]json.RawMessage) map[string]string {
	prices := map[string]string{}
	for key, upstream := range map[string]string{"input": "prompt", "output": "completion", "cacheRead": "input_cache_read", "cacheWrite": "input_cache_write"} {
		if p := price(pricing[upstream], 1000000); p != "" {
			prices[key] = p
		}
	}
	return prices
}
