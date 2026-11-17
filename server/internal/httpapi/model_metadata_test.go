package httpapi

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
	models, err = modelsDevMetadata([]byte(`{"provider":{"models":{"same":{"id":"same","name":"Host variant","limit":{"context":32000,"output":4096},"modalities":{"input":["text","image/png"],"output":["text"]},"cost":{"input":2.5,"output":10,"cache_read":0}}}},"other":{"models":{"same":{"cost":{"input":99}}}}}`), "provider")
	if err != nil || len(models) != 1 || models[0].Prices["input"] != "2.500000000000" || models[0].Vision == nil || !*models[0].Vision {
		t.Fatalf("provider isolation: %+v %v", models, err)
	}
	structured, err := modelsDevMetadata([]byte(`{"provider":{"models":{"m":{"cost":{"text":{"input":{"price":3,"cache":{"read":0.3}},"output":{"price":15}}}}}}}`), "provider")
	if err != nil || structured[0].Prices["input"] != "3.000000000000" || structured[0].Prices["cacheRead"] != "0.300000000000" {
		t.Fatalf("structured prices: %+v %v", structured, err)
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
		models, err := readMetadata(context.Background(), client, metadataLookup{Source: "models_dev", Provider: "p", Query: "m"})
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
	if _, err := readMetadata(context.Background(), client, metadataLookup{Source: "models_dev", Provider: "p", Query: "m"}); err == nil {
		t.Fatal("invalid upstream accepted")
	}
}

func TestMetadataLiveExchangeRate(t *testing.T) {
	client := &http.Client{Transport: metadataTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.frankfurter.dev" {
			t.Fatal(r.URL)
		}
		return metadataResponse(`{"base":"USD","date":"` + time.Now().UTC().Format("2006-01-02") + `","rates":{"CNY":6.6665}}`), nil
	})}
	rate, date := metadataExchangeRate(context.Background(), client)
	if rate != "6.666500000000" || date == "" {
		t.Fatalf("bad FX: %q %q", rate, date)
	}
	for _, raw := range []string{`{"base":"EUR","rates":{"CNY":7}}`, `{"base":"USD","date":"2020-01-01","rates":{"CNY":7}}`, `{"base":"USD","rates":{"CNY":0}}`} {
		client.Transport = metadataTransport(func(r *http.Request) (*http.Response, error) { return metadataResponse(raw), nil })
		if rate, _ := metadataExchangeRate(context.Background(), client); rate != "" {
			t.Fatal("guessed FX", rate)
		}
	}
	for _, raw := range []string{`null`, `"-1"`, `"invalid"`} {
		if metadataPrice(json.RawMessage(raw), 1000000) != "" {
			t.Fatal(raw)
		}
	}
}
