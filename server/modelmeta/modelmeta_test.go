package modelmeta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type metadataTransport func(*http.Request) (*http.Response, error)

func (f metadataTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func metadataResponse(body string) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestMetadataSupplierUnitsAndUnknownValues(t *testing.T) {
	models, err := openRouterMetadata([]byte(`{"data":[{"id":"lab/model","name":"Model","context_length":128000,"architecture":{"input_modalities":["text","image"],"output_modalities":["text"]},"top_provider":{"max_completion_tokens":8192},"pricing":{"prompt":"0.0000025","completion":"0","input_cache_read":"-1"}},{"id":"unknown"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	m := models[0]
	if m.Prices["input"] != "2.500000000000" || m.Prices["output"] != "0.000000000000" || len(m.Prices) != 2 || m.Vision == nil || !*m.Vision || *m.MaxTokens != 8192 {
		t.Fatalf("wrong normalization: %+v", m)
	}
	if models[1].Vision != nil || models[1].ContextWindow != nil || len(models[1].Prices) != 0 {
		t.Fatalf("unknown became a default: %+v", models[1])
	}
	models, _, err = modelsDevMetadata([]byte(`{"provider":{"models":{"same":{"id":"same","name":"Host variant","limit":{"context":32000,"output":4096},"modalities":{"input":["text","image/png"],"output":["text"]},"cost":{"input":2.5,"output":10,"cache_read":0}}}},"other":{"models":{"same":{"cost":{"input":99}}}}}`), "provider")
	if err != nil || len(models) != 1 || models[0].Prices["input"] != "2.500000000000" || models[0].Vision == nil || !*models[0].Vision {
		t.Fatalf("provider isolation: %+v %v", models, err)
	}
	structured, _, err := modelsDevMetadata([]byte(`{"provider":{"models":{"m":{"cost":{"text":{"input":{"price":3,"cache":{"read":0.3}},"output":{"price":15}}}}}}}`), "provider")
	if err != nil || structured[0].Prices["input"] != "3.000000000000" || structured[0].Prices["cacheRead"] != "0.300000000000" {
		t.Fatalf("structured prices: %+v %v", structured, err)
	}
	// One malformed entry, in another provider or beside a good one, never fails the lookup.
	tolerant, _, err := modelsDevMetadata([]byte(`{"broken":{"models":{"x":{"limit":{"context":"wide"}}}},"provider":{"models":{"bad":{"limit":{"context":1.5}},"odd":{"cost":{"text":[1]},"name":"Odd"},"good":{"name":"Good","limit":{"context":64000}}}}}`), "provider")
	if err != nil || len(tolerant) != 2 {
		t.Fatalf("one bad entry failed the lookup: %+v %v", tolerant, err)
	}
	if missing, everywhere, err := modelsDevMetadata([]byte(`{"other":{}}`), "provider"); err != nil || len(missing) != 0 || !everywhere {
		t.Fatalf("unknown provider: %+v %v", missing, err)
	}
}

func TestMetadataAlwaysQueriesFixedUpstream(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://models.dev/api.json" || r.Header.Get("Authorization") != "" || r.Header.Get("Cache-Control") == "" || r.Header.Get("User-Agent") != "DSH-Teamwork/1.0" {
			t.Fatalf("unexpected public request: %v", r)
		}
		return metadataResponse(`{"p":{"models":{"m":{"name":"Model"},"m-large":{"name":"Model large"}}}}`), nil
	})}
	for range 2 {
		models, err := Search(context.Background(), client, Query{Source: "models_dev", Provider: "p", Query: "m"})
		if err != nil || len(models) != 2 || models[0].ID != "m" {
			t.Fatalf("lookup: %+v %v", models, err)
		}
	}
	if calls != 2 {
		t.Fatalf("lookup was cached: %d", calls)
	}
	client.Transport = metadataTransport(func(r *http.Request) (*http.Response, error) {
		return metadataResponse(`<html>Unavailable</html>`), nil
	})
	if _, err := Search(context.Background(), client, Query{Source: "models_dev", Provider: "p", Query: "m"}); err == nil {
		t.Fatal("invalid upstream accepted")
	}
}

// A team's own proxy is no Models.dev provider: its model is found by exact id
// at every provider, and a substring never floods the answer.
func TestMetadataUnknownProviderSearchesEveryProviderByExactID(t *testing.T) {
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		return metadataResponse(`{"a":{"models":{"Deepseek-Chat":{"limit":{"context":64000}},"deepseek-chat-v2":{}}},"b":{"models":{"deepseek-chat":{"limit":{"context":128000}}}},"c":{"models":{"other":{}}}}`), nil
	})}
	for _, provider := range []string{"my-proxy", ""} {
		models, err := Search(context.Background(), client, Query{Source: "models_dev", Provider: provider, Query: "deepseek-chat"})
		if err != nil || len(models) != 2 || models[0].Provider != "a" || models[1].Provider != "b" {
			t.Fatalf("provider %q: %+v %v", provider, models, err)
		}
	}
	models, err := Search(context.Background(), client, Query{Source: "models_dev", Provider: "a", Query: "deepseek"})
	if err != nil || len(models) != 2 {
		t.Fatalf("a known provider still matches substrings: %+v %v", models, err)
	}
}

func TestMetadataLiveExchangeRate(t *testing.T) {
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.frankfurter.dev" {
			t.Fatal(r.URL)
		}
		return metadataResponse(`{"base":"USD","date":"` + time.Now().UTC().Format("2006-01-02") + `","rates":{"CNY":6.6665}}`), nil
	})}
	rate, date := ExchangeRate(context.Background(), client)
	if rate != "6.666500000000" || date == "" {
		t.Fatalf("bad FX: %q %q", rate, date)
	}
	for _, raw := range []string{`{"base":"EUR","rates":{"CNY":7}}`, `{"base":"USD","date":"2020-01-01","rates":{"CNY":7}}`, `{"base":"USD","rates":{"CNY":0}}`} {
		client.Transport = metadataTransport(func(r *http.Request) (*http.Response, error) { return metadataResponse(raw), nil })
		if rate, _ := ExchangeRate(context.Background(), client); rate != "" {
			t.Fatal("guessed FX", rate)
		}
	}
	for _, raw := range []string{`null`, `"-1"`, `"invalid"`} {
		if price(json.RawMessage(raw), 1000000) != "" {
			t.Fatal(raw)
		}
	}
}

func TestEndpointsAreEachUpstreamsOwnPrice(t *testing.T) {
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://openrouter.ai/api/v1/models/deepseek/deepseek-v3.2:free/endpoints" {
			t.Fatalf("unexpected request: %v", r.URL)
		}
		return metadataResponse(`{"data":{"id":"deepseek/deepseek-v3.2:free","endpoints":[{"tag":"deepinfra/fp8","provider_name":"DeepInfra","quantization":"fp8","context_length":163840,"max_completion_tokens":16384,"pricing":{"prompt":"0.00000027","completion":"0.0000004","input_cache_read":"0.000000216"}},{"provider_name":"No tag"}]}}`), nil
	})}
	endpoints, err := Endpoints(context.Background(), client, "deepseek/deepseek-v3.2:free")
	if err != nil || len(endpoints) != 1 {
		t.Fatalf("endpoints: %+v %v", endpoints, err)
	}
	e := endpoints[0]
	if e.Tag != "deepinfra/fp8" || e.Provider != "DeepInfra" || *e.ContextWindow != 163840 || *e.MaxTokens != 16384 ||
		e.Prices["input"] != "0.270000000000" || e.Prices["output"] != "0.400000000000" || e.Prices["cacheRead"] != "0.216000000000" || e.Prices["cacheWrite"] != "" {
		t.Fatalf("endpoint: %+v", e)
	}
	for _, id := range []string{"../../keys", "no-author", "a/b/c", "A/b"} {
		if _, err := Endpoints(context.Background(), client, id); err == nil {
			t.Errorf("accepted model id %q", id)
		}
	}
}

func TestModelsDevEffortsExcludeOtherControls(t *testing.T) {
	models, _, err := modelsDevMetadata([]byte(`{"example":{"models":{"match":{"reasoning_options":[
  {"type":"toggle"}, {"type":"budget_tokens","min":1024}, {"type":"effort","values":["none","low","max","low","unknown"]}
 ]},"toggle":{"reasoning_options":[{"type":"toggle"}]},"unknown":{}}}}`), "example")
	if err != nil || len(models) != 3 {
		t.Fatalf("metadata: %v %v", models, err)
	}
	for _, model := range models {
		switch model.ID {
		case "match":
			if model.ReasoningEfforts == nil || strings.Join(*model.ReasoningEfforts, ",") != "low,max" {
				t.Fatalf("efforts: %+v", model)
			}
		case "toggle":
			if model.ReasoningEfforts == nil || len(*model.ReasoningEfforts) != 0 {
				t.Fatalf("toggle: %+v", model)
			}
		case "unknown":
			if model.ReasoningEfforts != nil {
				t.Fatalf("unknown: %+v", model)
			}
		}
	}
}
