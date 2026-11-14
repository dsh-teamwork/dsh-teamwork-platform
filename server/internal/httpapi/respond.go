package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// maxBody is the largest JSON body a route reads unless it names its own.
const maxBody = 64 << 10

// errUnauthorized is a request with no identity this server accepts.
var errUnauthorized = wire.E(http.StatusUnauthorized, "unauthorized")

// readBody reads at most limit bytes; a larger body is 413
// payload_too_large, counted as it streams.
func readBody(r *http.Request, limit int64) ([]byte, error) {
	if r.ContentLength > limit {
		return nil, wire.E(http.StatusRequestEntityTooLarge, wire.PayloadTooLarge)
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, wire.E(http.StatusRequestEntityTooLarge, wire.PayloadTooLarge)
	}
	return b, nil
}

// decode reads a JSON body into v and validates it when v can.
func decode(r *http.Request, v any) error {
	b, err := readBody(r, maxBody)
	if err != nil {
		return err
	}
	if err := wire.Decode(b, v, false); err != nil {
		return err
	}
	if val, ok := v.(interface{ Validate() error }); ok {
		return val.Validate()
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// refusalStatus is the status each sign-in refusal answers with.
var refusalStatus = map[string]int{
	wire.InvalidCredentials:     http.StatusUnauthorized,
	wire.InvalidCode:            http.StatusUnauthorized,
	wire.TooManyAttempts:        http.StatusTooManyRequests,
	wire.SetupClosed:            http.StatusForbidden,
	wire.NotAllowed:             http.StatusForbidden,
	wire.PasswordChangeRequired: http.StatusForbidden,
	wire.Unavailable:            http.StatusServiceUnavailable,
}

// fail answers an error as `{ error, issues? }`: a stable code, never a
// sentence. Anything unexpected is logged and is a 500.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	var we *wire.Error
	var invalid *wire.Invalid
	var refusal *auth.Refusal
	switch {
	case errors.As(err, &we):
		writeJSON(w, we.Status, map[string]string{"error": we.Code})
	case errors.As(err, &invalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_request", "issues": invalid.Issues})
	case errors.As(err, &refusal):
		status, ok := refusalStatus[refusal.Code]
		if !ok {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": refusal.Code})
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
	}
}
