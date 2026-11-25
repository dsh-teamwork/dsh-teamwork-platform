package manage

import (
	"context"
	"math"
	"math/big"
	"net/http"
	"sort"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
)

type activityRoute struct {
	Route              string `json:"route"`
	Admitted           int64  `json:"admitted"`
	Succeeded          int64  `json:"succeeded"`
	InputTokens        int64  `json:"inputTokens"`
	OutputTokens       int64  `json:"outputTokens"`
	CallsWithTokens    int64  `json:"callsWithTokens"`
	CallsMissingTokens int64  `json:"callsMissingTokens"`
	Points             string `json:"points"`
	units              big.Int
}

type activityModel struct {
	Route     string `json:"route"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Admitted  int64  `json:"admitted"`
	Succeeded int64  `json:"succeeded"`
	Errored   int64  `json:"errored"`
}

type modelKey struct{ route, provider, model string }

func getActivity(a *api, w http.ResponseWriter, r *http.Request, _ actor) error {
	q := r.URL.Query()
	window, field := edition.ParseActivityWindow(q.Get("from"), q.Get("to"), time.Now())
	switch field {
	case "from", "to":
		return invalid(field, "YYYY-MM-DD")
	case "range":
		return invalid(field, "1 to 93 UTC days, ending no later than today")
	}
	result, err := a.host.Activity(r.Context(), window)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, result)
	return nil
}

// Activity supplies the same aggregate to the open API and to edition extensions.
func Activity(db *ent.Client) func(context.Context, edition.ActivityWindow) (any, error) {
	return func(ctx context.Context, window edition.ActivityWindow) (any, error) {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		start, end := window.Start, window.End
		users, err := db.User.Query().Count(ctx)
		if err != nil {
			return nil, err
		}
		newUsers, err := db.User.Query().Where(user.CreatedAtGTE(start), user.CreatedAtLT(end)).Count(ctx)
		if err != nil {
			return nil, err
		}
		teams, err := db.Team.Query().Count(ctx)
		if err != nil {
			return nil, err
		}
		newTeams, err := db.Team.Query().Where(team.CreatedAtGTE(start), team.CreatedAtLT(end)).Count(ctx)
		if err != nil {
			return nil, err
		}
		models, err := modelActivity(ctx, db, start, end)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"from": start.Format(time.DateOnly), "to": end.AddDate(0, 0, -1).Format(time.DateOnly), "asOf": window.AsOf,
			"accounts":            map[string]int{"users": users, "newUsers": newUsers, "teams": teams, "newTeams": newTeams},
			"models":              models,
			"refusalsBeforeAdmit": nil, "upstreamLatency": nil,
			"coverage": map[string]string{"refusalsBeforeAdmit": "not_collected", "upstreamLatency": "not_collected"},
		}, nil
	}
}

func modelActivity(ctx context.Context, db *ent.Client, start, end time.Time) (map[string]any, error) {
	routes := []*activityRoute{{Route: "byok"}, {Route: "hosted"}, {Route: "other"}}
	groups := map[modelKey]*activityModel{}
	var admitted, succeeded, unresolved, estimated, errored int64
	cursor := ""
	for {
		rows, err := db.UsageRequest.Query().Where(
			usagerequest.IDGT(cursor), usagerequest.MeterEQ(""), usagerequest.CreatedAtGTE(start), usagerequest.CreatedAtLT(end),
		).Select(usagerequest.FieldID, usagerequest.FieldRouteOwner, usagerequest.FieldProvider, usagerequest.FieldModel,
			usagerequest.FieldState, usagerequest.FieldErrorCode, usagerequest.FieldPointUnits, usagerequest.FieldInputTokens,
			usagerequest.FieldOutputTokens).Order(ent.Asc(usagerequest.FieldID)).Limit(500).All(ctx)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			cursor = row.ID
			route := routes[2]
			switch row.RouteOwner {
			case "":
				route = routes[0]
			case "billing":
				route = routes[1]
			}
			key := modelKey{route.Route, row.Provider, row.Model}
			model := groups[key]
			if model == nil {
				model = &activityModel{Route: key.route, Provider: key.provider, Model: key.model}
				groups[key] = model
			}
			admitted++
			route.Admitted++
			model.Admitted++
			if row.State == usagerequest.StateEstimated {
				estimated++
			}
			switch {
			case row.ErrorCode != "":
				errored++
				model.Errored++
			case row.State == usagerequest.StateSettled:
				succeeded++
				route.Succeeded++
				model.Succeeded++
				if row.PointUnits != nil {
					if *row.PointUnits < 0 {
						return nil, edition.ErrAmount
					}
					route.units.Add(&route.units, big.NewInt(*row.PointUnits))
				}
			case row.State == usagerequest.StateRunning || row.State == usagerequest.StatePending || row.State == usagerequest.StateUnpriced:
				unresolved++
			}
			if row.InputTokens == nil || row.OutputTokens == nil {
				route.CallsMissingTokens++
			} else {
				route.CallsWithTokens++
			}
			if !addActivityTokens(&route.InputTokens, row.InputTokens) || !addActivityTokens(&route.OutputTokens, row.OutputTokens) {
				return nil, edition.ErrAmount
			}
		}
		if len(rows) < 500 {
			break
		}
	}
	for _, route := range routes {
		var whole, fraction big.Int
		whole.QuoRem(&route.units, big.NewInt(edition.UnitsPerPoint), &fraction)
		route.Points = edition.FormatPoints(fraction.Int64())
		if whole.Sign() != 0 {
			route.Points = whole.String() + route.Points[1:]
		}
	}
	models := make([]*activityModel, 0, len(groups))
	for _, model := range groups {
		models = append(models, model)
	}
	sort.Slice(models, func(i, j int) bool {
		a, b := models[i], models[j]
		switch {
		case a.Admitted != b.Admitted:
			return a.Admitted > b.Admitted
		case a.Provider != b.Provider:
			return a.Provider < b.Provider
		case a.Model != b.Model:
			return a.Model < b.Model
		default:
			return a.Route < b.Route
		}
	})
	return map[string]any{
		"admitted": admitted, "succeeded": succeeded, "unresolved": unresolved, "estimated": estimated, "errored": errored,
		"byRoute": routes, "byModel": models[:min(50, len(models))], "truncatedModels": len(models) > 50,
	}, nil
}

func addActivityTokens(total *int64, tokens *int64) bool {
	if tokens == nil {
		return true
	}
	if *tokens < 0 || *tokens > math.MaxInt64-*total {
		return false
	}
	*total += *tokens
	return true
}
