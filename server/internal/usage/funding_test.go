package usage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
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

// An owned model reaches the team's configuration with the bounds the plugin
// sizes it by, and publishing it again with other bounds or another name
// changes it under a new version, which is what makes the plugin sync it;
// the same publication again changes nothing.
func TestAPublishedModelCarriesItsBoundsAndARepublicationRefreshesThem(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		team := d.Client.Team.Create().SetName("Hosted").SaveX(ctx)
		s := &Service{DB: d.Client}
		host, err := s.RegisterFunding("billing", quoting{})
		if err != nil {
			t.Fatal(err)
		}
		publish := func(m edition.OwnedModel) error {
			return host.WithTeamTx(ctx, team.ID, func(tx edition.SQLExecutor) error { return host.PublishModel(ctx, tx, team.ID, m) })
		}
		read := func() (*ent.TeamConfig, wire.ModelData) {
			c := d.Client.TeamConfig.GetX(ctx, "astra")
			var data wire.ModelData
			if err := json.Unmarshal(c.Data, &data); err != nil {
				t.Fatal(err)
			}
			return c, data
		}
		m := edition.OwnedModel{ConfigID: "astra", Name: "Astra", Reference: "openai/astra", ContextWindow: 1_050_000, MaxTokens: 128_000}
		if err := publish(m); err != nil {
			t.Fatal(err)
		}
		c, data := read()
		if data.Provider != wire.HostedProvider || data.Model != "openai/astra" || data.ContextWindow == nil || *data.ContextWindow != 1_050_000 || data.MaxTokens == nil || *data.MaxTokens != 128_000 || c.Version != 1 {
			t.Fatalf("published %s at version %d", c.Data, c.Version)
		}
		if err := publish(m); err != nil {
			t.Fatal(err)
		}
		if c, _ := read(); c.Version != 1 {
			t.Fatalf("an unchanged publication moved the version to %d", c.Version)
		}
		m.Name, m.ContextWindow, m.MaxTokens = "Astra 2", 400_000, 32_000
		if err := publish(m); err != nil {
			t.Fatal(err)
		}
		if c, data := read(); c.Name != "Astra 2" || *data.ContextWindow != 400_000 || *data.MaxTokens != 32_000 || c.Version != 2 {
			t.Fatalf("republished as %q %s at version %d", c.Name, c.Data, c.Version)
		}
		// Taken out of service, it stays in the team, marked, under a new version the plugin syncs; back in
		// service, the mark goes the same way.
		m.Offline = true
		if err := publish(m); err != nil {
			t.Fatal(err)
		}
		if c, data := read(); !data.Offline || c.Version != 3 {
			t.Fatalf("taken offline as %s at version %d", c.Data, c.Version)
		}
		m.Offline = false
		if err := publish(m); err != nil {
			t.Fatal(err)
		}
		if c, data := read(); data.Offline || bytes.Contains(c.Data, []byte("offline")) || c.Version != 4 {
			t.Fatalf("back in service as %s at version %d", c.Data, c.Version)
		}
		for _, bad := range []edition.OwnedModel{
			{ConfigID: "astra", Name: "Astra", Reference: "openai/other", ContextWindow: 1, MaxTokens: 1},
			{ConfigID: "astra", Name: "Astra", Reference: "openai/astra", ContextWindow: 0, MaxTokens: 1},
			{ConfigID: "astra", Name: "Astra", Reference: "openai/astra", ContextWindow: 10_000_001, MaxTokens: 1},
		} {
			if err := publish(bad); err == nil {
				t.Fatalf("published %+v", bad)
			}
		}
		gone := func(tx edition.SQLExecutor) error {
			return host.PublishModel(ctx, tx, "deleted-team", edition.OwnedModel{ConfigID: "gone", Name: "Astra", Reference: "openai/astra", ContextWindow: 1, MaxTokens: 1})
		}
		if err := host.WithTeamTx(ctx, "deleted-team", gone); !errors.Is(err, edition.ErrTeamGone) {
			t.Fatalf("published into a team that does not exist: %v", err)
		}
	})
}
