package usage

import (
	"math"
	"testing"
)

func TestExactPriceAndDisjointTokens(t *testing.T) {
	in, _ := Decimal("2", 6)
	cache, _ := Decimal("0.2", 6)
	out, _ := Decimal("8", 6)
	r := Rates{Input: in, CacheRead: cache, Output: out}
	units, err := r.Cost(Tokens{Input: 2000, Output: 1000, Reasoning: 400})
	if err != nil || FormatPoints(units) != "12" {
		t.Fatalf("input plus output including reasoning: %d %v", units, err)
	}
	units, err = r.Cost(Tokens{Input: 2000, CacheRead: 1000, Output: 1000, Reasoning: 400})
	if err != nil || FormatPoints(units) != "10.2" {
		t.Fatalf("cache replaces input, not adds to it: %d %v", units, err)
	}
	tiny, _ := Decimal("0.000001", 6)
	units, err = (Rates{Input: tiny}).Cost(Tokens{Input: 1})
	if err != nil || units != 1 || FormatPoints(units) != "0.000000001" {
		t.Fatalf("smallest exact token price: %d %v", units, err)
	}
}

func TestPriceRejectsInvalidAndOverflowingAmounts(t *testing.T) {
	for _, s := range []string{"", "-1", "+1", "1e3", "NaN", " 1", "1.", ".1", "0.0000001", "9223372036854.775808"} {
		if _, err := Decimal(s, 6); err == nil {
			t.Errorf("accepted %q", s)
		}
	}
	for _, tc := range []struct {
		r Rates
		t Tokens
	}{
		{Rates{Input: math.MaxInt64}, Tokens{Input: 2}},
		{Rates{Input: math.MaxInt64, Output: 1}, Tokens{Input: 1, Output: 1}},
		{Rates{Input: -1}, Tokens{}},
		{Rates{}, Tokens{Input: 1, CacheRead: 2}},
		{Rates{}, Tokens{Input: 1, Output: 1, Reasoning: 2}},
	} {
		if _, err := tc.r.Cost(tc.t); err == nil {
			t.Errorf("accepted invalid price/tokens: %+v %+v", tc.r, tc.t)
		}
	}
}

func TestBoundCoversCustomCachePrice(t *testing.T) {
	r := Rates{Input: 1, CacheRead: 5, CacheWrite: 8, Output: 2}
	bound, err := r.Bound(100, 10)
	if err != nil || bound != 820 {
		t.Fatalf("bound = %d, %v", bound, err)
	}
}
