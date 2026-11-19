package usage

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
)

type quoting struct{ q edition.FundingQuote }

func (p quoting) Quote(context.Context, edition.ModelReference) (edition.FundingQuote, error) {
	return p.q, nil
}
func (quoting) Reserve(context.Context, edition.SQLExecutor, edition.FundingAdmission) error {
	return nil
}
func (quoting) Settle(context.Context, edition.SQLExecutor, edition.FundingSettlement) error {
	return nil
}

// A participant's quote is checked before the gateway trusts it: a route
// without bounds, or whose body would override a field the caller's request
// was checked and priced for, never reaches an upstream.
func TestQuoteNeedsBoundsAndCannotOverrideCheckedFields(t *testing.T) {
	good := edition.FundingQuote{RateID: "r", Model: "m", BaseURL: "https://x.test", APIKey: "k", MaxInput: 1000, MaxOutput: 100,
		Body: map[string]json.RawMessage{"provider": json.RawMessage(`{"order":["a"]}`)}}
	for name, mutate := range map[string]func(*edition.FundingQuote){
		"ok":              func(*edition.FundingQuote) {},
		"no input bound":  func(q *edition.FundingQuote) { q.MaxInput = 0 },
		"no output bound": func(q *edition.FundingQuote) { q.MaxOutput = 0 },
		"huge bound":      func(q *edition.FundingQuote) { q.MaxInput = MaxRouteInput + 1 },
		"model":           func(q *edition.FundingQuote) { q.Body = map[string]json.RawMessage{"model": json.RawMessage(`"x"`)} },
		"checked field":   func(q *edition.FundingQuote) { q.Body = map[string]json.RawMessage{"max_tokens": json.RawMessage(`9`)} },
		"invalid JSON":    func(q *edition.FundingQuote) { q.Body = map[string]json.RawMessage{"provider": json.RawMessage(`{`)} },
	} {
		q := good
		mutate(&q)
		s := &Service{Funding: map[string]edition.ModelFunding{"x": quoting{q}}}
		_, err := s.Quote(context.Background(), "x", edition.ModelReference{})
		if (err == nil) != (name == "ok") {
			t.Errorf("%s: %v", name, err)
		}
	}
}
