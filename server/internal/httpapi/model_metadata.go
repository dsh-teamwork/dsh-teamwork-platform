package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/modelmeta"
)

// Metadata is a transient form suggestion (server/modelmeta). No lookup
// identity or upstream data is written to team configuration, rates, or a
// local catalog.
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
	if (in.Source != "models_dev" && in.Source != "openrouter") || in.Query == "" || len(in.Query) > 200 || len(in.Provider) > 100 {
		var issues wire.Issues
		issues.Add("A source and a model query")
		return issues.Err()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	models, err := modelmeta.Search(ctx, s.Gateway.Client, modelmeta.Query{Source: in.Source, Provider: in.Provider, Query: in.Query})
	if err != nil {
		return wire.E(http.StatusBadGateway, wire.ModelMetadataUnavailable)
	}
	if in.Source == "openrouter" && len(models) > 0 {
		// Prices and limits come from OpenRouter. Effort choices use its own entries in Models.dev.
		dev, _ := modelmeta.Search(ctx, s.Gateway.Client, modelmeta.Query{Source: "models_dev", Provider: "openrouter", Query: in.Query})
		for i := range models {
			for _, entry := range dev {
				if entry.Provider == "openrouter" && entry.ID == models[i].ID {
					models[i].ReasoningEfforts = entry.ReasoningEfforts
					break
				}
			}
		}
	}
	noStore(w)
	result := map[string]any{"models": models}
	if in.Pricing && len(models) > 0 {
		if fx, date := modelmeta.ExchangeRate(ctx, s.Gateway.Client); fx != "" {
			result["usdToCny"], result["exchangeDate"] = fx, date
		}
	}
	writeJSON(w, http.StatusOK, result)
	return nil
}
