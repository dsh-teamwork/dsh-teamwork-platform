// Package usage measures provider usage and enforces a team's internal budget.
// Points are reference usage units, not a redeemable monetary balance.
package usage

import (
	"errors"
	"math"
	"strconv"
	"strings"
)

const UnitsPerPoint int64 = 1_000_000_000

var ErrAmount = errors.New("invalid or overflowing usage amount")

// Decimal parses a nonnegative decimal exactly, without binary floating point.
func Decimal(s string, places int) (int64, error) {
	if places < 0 || places > 9 || s == "" || len(s) > 32 {
		return 0, ErrAmount
	}
	parts := strings.Split(s, ".")
	if len(parts) > 2 || parts[0] == "" || len(parts) == 2 && (parts[1] == "" || len(parts[1]) > places) {
		return 0, ErrAmount
	}
	for _, part := range parts {
		for _, c := range part {
			if c < '0' || c > '9' {
				return 0, ErrAmount
			}
		}
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	n, err := strconv.ParseInt(parts[0]+fraction+strings.Repeat("0", places-len(fraction)), 10, 64)
	if err != nil {
		return 0, ErrAmount
	}
	return n, nil
}

// FormatPoints keeps all stored precision; the UI can shorten it for display.
func FormatPoints(units int64) string {
	whole, fraction := units/UnitsPerPoint, units%UnitsPerPoint
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	return strconv.FormatInt(whole, 10) + "." + strings.TrimRight(strconv.FormatInt(UnitsPerPoint+fraction, 10)[1:], "0")
}

// Rates are integer units per token. CNY/million-token prices with six decimal
// places convert using Decimal(price, 6): one CNY is 1,000 points.
type Rates struct {
	Input      int64 `json:"input,string"`
	CacheRead  int64 `json:"cacheRead,string"`
	CacheWrite int64 `json:"cacheWrite,string"`
	Output     int64 `json:"output,string"`
}

// Tokens.Input includes cached tokens; Output includes reasoning tokens.
// The subcounts are not additional billable tokens.
type Tokens struct {
	Input      int64 `json:"input"`
	CacheRead  int64 `json:"cacheRead"`
	CacheWrite int64 `json:"cacheWrite"`
	Output     int64 `json:"output"`
	Reasoning  int64 `json:"reasoning"`
}

func (t Tokens) Valid() bool {
	return t.Input >= 0 && t.Output >= 0 && t.CacheRead >= 0 && t.CacheWrite >= 0 && t.Reasoning >= 0 &&
		t.CacheRead <= t.Input && t.CacheWrite <= t.Input-t.CacheRead && t.Reasoning <= t.Output &&
		t.Input <= math.MaxInt64-t.Output
}

func addProduct(sum, count, rate int64) (int64, error) {
	if count < 0 || rate < 0 || rate != 0 && count > (math.MaxInt64-sum)/rate {
		return 0, ErrAmount
	}
	return sum + count*rate, nil
}

func (r Rates) Cost(t Tokens) (int64, error) {
	if !t.Valid() {
		return 0, ErrAmount
	}
	var sum int64
	for _, pair := range [][2]int64{{t.Input - t.CacheRead - t.CacheWrite, r.Input}, {t.CacheRead, r.CacheRead}, {t.CacheWrite, r.CacheWrite}, {t.Output, r.Output}} {
		var err error
		sum, err = addProduct(sum, pair[0], pair[1])
		if err != nil {
			return 0, err
		}
	}
	return sum, nil
}

// Bound reserves for the most expensive possible input bucket, even when a
// custom cache price is higher than uncached input. Token bounds are supplied
// by the route's separately validated provider contract, not a text heuristic.
func (r Rates) Bound(input, output int64) (int64, error) {
	if r.Input < 0 || r.CacheRead < 0 || r.CacheWrite < 0 || r.Output < 0 {
		return 0, ErrAmount
	}
	sum, err := addProduct(0, input, max(r.Input, r.CacheRead, r.CacheWrite))
	if err != nil {
		return 0, err
	}
	return addProduct(sum, output, r.Output)
}
