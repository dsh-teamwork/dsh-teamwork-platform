package usage

import (
	"context"
	"sort"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
)

// MaxStatsSpan bounds a stats read: every row in it is read once.
const MaxStatsSpan = 92 * 24 * time.Hour

// Stats is a period's usage at a glance, for "My usage" and an admin's view of
// the team or one member: its totals, each day's, and each model's and meter's.
type Stats struct {
	Since    string      `json:"since"`
	Until    string      `json:"until"`
	Timezone string      `json:"timezone"`
	Totals   StatsTotals `json:"totals"`
	Days     []StatsDay  `json:"days"`
	Sources  []StatsRow  `json:"sources"`
}

// StatsTotals counts model calls; points also sum what edition meters spent,
// as the team summary's do. Unpriced is the calls whose points are not known
// yet (still running, pending, or recorded unpriced), which points leaves out.
type StatsTotals struct {
	Calls      int    `json:"calls"`
	Points     string `json:"points"`
	Unpriced   int    `json:"unpriced"`
	Input      int64  `json:"input"`
	CacheRead  int64  `json:"cacheRead"`
	CacheWrite int64  `json:"cacheWrite"`
	Output     int64  `json:"output"`
	Reasoning  int64  `json:"reasoning"`
}

// StatsDay is one calendar day in the requested timezone, present even when nothing was spent.
type StatsDay struct {
	Day    string `json:"day"`
	Calls  int    `json:"calls"`
	Points string `json:"points"`
}

// StatsRow is what one team model, or one edition meter, spent: a model by its
// configuration id and current name (the call's upstream model once the
// configuration is gone), a meter by its name and the words its edition
// registered for it, by language (empty for a model, as for a meter no edition
// registers any more).
type StatsRow struct {
	Kind   string            `json:"kind"`
	Key    string            `json:"key"`
	Name   string            `json:"name"`
	Labels map[string]string `json:"labels"`
	Calls  int               `json:"calls"`
	Points string            `json:"points"`
	Input  int64             `json:"input"`
	Output int64             `json:"output"`
}

type tally struct {
	calls         int
	units         int64
	input, output int64
	name          string
	kind, key     string
}

// Stats reads f's rows between f.Since and f.Until, bucketing days in loc.
// The caller bounds the span (MaxStatsSpan) and scopes f to who may see it.
func (s *Service) Stats(ctx context.Context, f Filter, loc *time.Location) (Stats, error) {
	rows, err := s.query(f).Select(
		usagerequest.FieldCreatedAt, usagerequest.FieldConfigID, usagerequest.FieldModel, usagerequest.FieldMeter,
		usagerequest.FieldState, usagerequest.FieldPointUnits, usagerequest.FieldInputTokens, usagerequest.FieldCacheReadTokens,
		usagerequest.FieldCacheWriteTokens, usagerequest.FieldOutputTokens, usagerequest.FieldReasoningTokens,
	).All(ctx)
	if err != nil {
		return Stats{}, err
	}
	out := Stats{Since: f.Since.UTC().Format(time.RFC3339Nano), Until: f.Until.UTC().Format(time.RFC3339Nano), Timezone: loc.String(), Days: []StatsDay{}, Sources: []StatsRow{}}

	// Every day of the period, so a chart has no gaps.
	type day struct {
		calls int
		units int64
	}
	days := map[string]*day{}
	order := []string{}
	for d := f.Since.In(loc); d.Before(f.Until); d = time.Date(d.Year(), d.Month(), d.Day()+1, 0, 0, 0, 0, loc) {
		key := d.Format(time.DateOnly)
		days[key] = &day{}
		order = append(order, key)
	}

	sources := map[string]*tally{}
	var units int64
	add := func(p *int64) int64 {
		if p == nil {
			return 0
		}
		return *p
	}
	for _, r := range rows {
		d := days[r.CreatedAt.In(loc).Format(time.DateOnly)]
		key, kind := r.ConfigID, "model"
		if r.Meter != "" {
			key, kind = r.Meter, "meter"
		}
		src := sources[kind+":"+key]
		if src == nil {
			src = &tally{kind: kind, key: key, name: r.Model}
			if kind == "meter" {
				src.name = r.Meter
			}
			sources[kind+":"+key] = src
		}
		u := add(r.PointUnits)
		units += u
		src.units += u
		if d != nil {
			d.units += u
		}
		// A metered row is no model call (ADR 0036): it adds points, not calls or tokens.
		if r.Meter != "" {
			continue
		}
		out.Totals.Calls++
		src.calls++
		if d != nil {
			d.calls++
		}
		if r.PointUnits == nil {
			out.Totals.Unpriced++
		}
		out.Totals.Input += add(r.InputTokens)
		out.Totals.CacheRead += add(r.CacheReadTokens)
		out.Totals.CacheWrite += add(r.CacheWriteTokens)
		out.Totals.Output += add(r.OutputTokens)
		out.Totals.Reasoning += add(r.ReasoningTokens)
		src.input += add(r.InputTokens)
		src.output += add(r.OutputTokens)
	}
	out.Totals.Points = FormatPoints(units)
	for _, key := range order {
		out.Days = append(out.Days, StatsDay{Day: key, Calls: days[key].calls, Points: FormatPoints(days[key].units)})
	}

	// A model is named as the team names it now.
	ids := []string{}
	for _, src := range sources {
		if src.kind == "model" {
			ids = append(ids, src.key)
		}
	}
	if len(ids) > 0 {
		configs, err := s.DB.TeamConfig.Query().Where(teamconfig.TeamID(f.TeamID), teamconfig.IDIn(ids...)).All(ctx)
		if err != nil {
			return Stats{}, err
		}
		for _, c := range configs {
			sources["model:"+c.ID].name = c.Name
		}
	}
	list := make([]*tally, 0, len(sources))
	for _, src := range sources {
		list = append(list, src)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].units != list[j].units {
			return list[i].units > list[j].units
		}
		if list[i].calls != list[j].calls {
			return list[i].calls > list[j].calls
		}
		return list[i].kind+list[i].key < list[j].kind+list[j].key
	})
	for _, src := range list {
		labels := map[string]string{}
		if m, ok := s.Meters[src.key]; ok && src.kind == "meter" {
			labels = m.meter.Labels
		}
		out.Sources = append(out.Sources, StatsRow{Kind: src.kind, Key: src.key, Name: src.name, Labels: labels, Calls: src.calls, Points: FormatPoints(src.units), Input: src.input, Output: src.output})
	}
	return out, nil
}
