package httpapi_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// Every answer a test reads through do() is held to api/openapi.yaml: its
// status must be documented for the route, and its body must match.

var (
	specOnce sync.Once
	spec     *openapi3.T
	specErr  error
	contract sync.Map // a server's base URL → its router
)

func loadSpec() (*openapi3.T, error) {
	specOnce.Do(func() {
		_, here, _, _ := runtime.Caller(0)
		path := filepath.Join(filepath.Dir(here), "..", "..", "..", "api", "openapi.yaml")
		loader := openapi3.NewLoader()
		spec, specErr = loader.LoadFromFile(path)
		if specErr == nil {
			specErr = spec.Validate(context.Background())
		}
	})
	return spec, specErr
}

// holdToContract registers a running server's base URL.
func holdToContract(t *testing.T, base string) {
	t.Helper()
	doc, err := loadSpec()
	if err != nil {
		t.Fatalf("api/openapi.yaml: %v", err)
	}
	copy := *doc
	copy.Servers = openapi3.Servers{{URL: base + "/api"}}
	router, err := gorillamux.NewRouter(&copy)
	if err != nil {
		t.Fatal(err)
	}
	contract.Store(base, router)
	t.Cleanup(func() { contract.Delete(base) })
}

// checkContract validates one answer against the route it was sent to.
func checkContract(t *testing.T, req *http.Request, res *http.Response, body []byte) {
	t.Helper()
	var router routers.Router
	contract.Range(func(k, v any) bool {
		if strings.HasPrefix(req.URL.String(), k.(string)+"/") {
			router = v.(routers.Router)
			return false
		}
		return true
	})
	if router == nil || !strings.HasPrefix(req.URL.Path, "/api/") {
		return
	}
	route, params, err := router.FindRoute(req)
	if err != nil {
		if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusMethodNotAllowed {
			return // an address no route claims
		}
		t.Errorf("contract: %s %s is not in api/openapi.yaml (%v)", req.Method, req.URL.Path, err)
		return
	}
	if res.Header.Get("Content-Type") == "text/event-stream" {
		return
	}
	in := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route},
		Status:                 res.StatusCode,
		Header:                 res.Header,
		Body:                   io.NopCloser(bytes.NewReader(body)),
		Options:                &openapi3filter.Options{IncludeResponseStatus: true},
	}
	if err := openapi3filter.ValidateResponse(context.Background(), in); err != nil {
		t.Errorf("contract: %s %s answered %d against api/openapi.yaml: %v\n%s", req.Method, req.URL.Path, res.StatusCode, err, body)
	}
}
