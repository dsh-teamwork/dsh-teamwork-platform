// Package httpapi is the HTTP surface: the API the console and the DSH plugin
// call, and the console itself for every other path.
package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Server holds what the handlers need.
type Server struct {
	Config  config.Config
	Auth    *auth.Service
	Team    *team.Service
	Gateway *gateway.Gateway
	Web     http.Handler
}

// handler is a route that answers with an error instead of writing one.
type handler func(w http.ResponseWriter, r *http.Request) error

func (s *Server) route(h handler, write bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if write && !s.sameOrigin(r) {
			fail(w, r, wire.E(http.StatusForbidden, "cross_origin"))
			return
		}
		if err := h(w, r); err != nil {
			fail(w, r, err)
		}
	}
}

// Handler is every route.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	get := func(pattern string, h handler) { mux.HandleFunc("GET "+pattern, s.route(h, false)) }
	post := func(pattern string, h handler) { mux.HandleFunc("POST "+pattern, s.route(h, true)) }

	get("/api/auth/session", s.session)
	post("/api/auth/password/sign-in", s.passwordSignIn)
	post("/api/auth/setup", s.setup)
	post("/api/auth/password/change", s.changePassword)
	post("/api/auth/sign-out", s.signOut)
	post("/api/auth/plugin/code", s.pluginCode)
	// No cookie authorizes it and a code is useless without its verifier, so
	// any client may call it from anywhere, Origin or not.
	mux.HandleFunc("POST /api/auth/plugin/token", s.route(s.pluginToken, false))

	post("/api/teams", s.createTeam)
	post("/api/teams/{teamId}/providers", s.createProvider)
	post("/api/teams/{teamId}/configs", s.createConfig)
	get("/api/configs", s.configs)
	post("/api/llm/chat/completions", s.completions)

	// An /api address no route claims answers in the API's shape, not as a page.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	})
	if s.Web != nil {
		mux.Handle("/", s.Web)
	}
	return recoverer(headers(mux))
}

func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic", "method", r.Method, "path", r.URL.Path, "panic", v)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
