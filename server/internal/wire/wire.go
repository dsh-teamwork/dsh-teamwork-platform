// Package wire is what crosses the API: request shapes, the rules every write
// is held to, and the error codes a client branches on. It restates
// @dsh-teamwork/shared (packages/shared/src/{auth,team}.ts) until the Node
// server is deleted; api/openapi.yaml describes the same shapes.
package wire

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Issue is one reason a request failed validation, as `{ path, message }`.
type Issue struct {
	Path    []any  `json:"path"`
	Message string `json:"message"`
}

// Issues collects what is wrong with one request.
type Issues []Issue

func (is *Issues) Add(message string, path ...any) {
	if path == nil {
		path = []any{}
	}
	*is = append(*is, Issue{Path: path, Message: message})
}

// Err is the request's issues as an error, or nil when there are none.
func (is Issues) Err() error {
	if len(is) == 0 {
		return nil
	}
	return &Invalid{Issues: is}
}

// Invalid is a request that failed validation: 400 invalid_request.
type Invalid struct{ Issues Issues }

func (e *Invalid) Error() string { return fmt.Sprintf("invalid request: %v", e.Issues) }

// Error is a refusal the API names: a status and a stable code.
type Error struct {
	Status int
	Code   string
}

func (e *Error) Error() string { return e.Code }

// E makes an Error.
func E(status int, code string) *Error { return &Error{Status: status, Code: code} }

// Decode reads JSON into v, refusing fields v does not declare when strict.
func Decode(raw json.RawMessage, v any, strict bool) error {
	if len(raw) == 0 || string(raw) == "null" {
		return &Invalid{Issues: Issues{{Path: []any{}, Message: "Expected an object"}}}
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if strict {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(v); err != nil {
		return &Invalid{Issues: Issues{{Path: []any{}, Message: err.Error()}}}
	}
	return nil
}
