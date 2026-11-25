package edition

import (
	"time"
)

// ActivityWindow is an inclusive range of UTC dates represented by half-open bounds.
type ActivityWindow struct {
	Start, End, AsOf time.Time
}

// ParseActivityWindow returns the invalid query field, or an empty string on success.
func ParseActivityWindow(from, to string, now time.Time) (ActivityWindow, string) {
	now = now.UTC()
	today := now.Truncate(24 * time.Hour)
	last := today
	var err error
	if to != "" {
		last, err = time.Parse(time.DateOnly, to)
		if err != nil {
			return ActivityWindow{}, "to"
		}
	}
	first := last
	if from != "" {
		first, err = time.Parse(time.DateOnly, from)
		if err != nil {
			return ActivityWindow{}, "from"
		}
	}
	end := last.AddDate(0, 0, 1)
	if first.After(last) || last.After(today) || end.Sub(first) > 93*24*time.Hour {
		return ActivityWindow{}, "range"
	}
	return ActivityWindow{Start: first, End: end, AsOf: now}, ""
}

// ActivityInsights holds the open aggregates needed by a daily report.
type ActivityInsights struct {
	Collaboration, Reliability map[string]any
	BudgetSuspensions          int
	Coverage                   map[string]string
}
