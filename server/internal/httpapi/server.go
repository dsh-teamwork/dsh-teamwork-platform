// Package httpapi is the HTTP surface: the API the console and the DSH plugin
// call, and the public pages and the console (package web) for every other
// path.
package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/analytics"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/usage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Server holds what the handlers need.
type Server struct {
	ManageRoot bool
	Config     config.Config
	Auth       *auth.Service
	Team       *team.Service
	Gateway    *gateway.Gateway
	Usage      *usage.Service
	Mailer     auth.Mailer       // where SMTP_URL is set
	Google     *auth.Google      // where the Google door is configured
	Analytics  *analytics.Client // nil or keyless sends nothing
	Web        http.Handler
	// Mux, when set, is the router Handler adds its routes to: one a closed
	// edition has already added its own to (server/edition).
	Mux       *http.ServeMux
	TeamPages []edition.TeamPage
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
	if s.Usage == nil && s.Team != nil {
		s.Usage = &usage.Service{DB: s.Team.DB, AppURL: s.Config.AppURL}
	}
	if s.Gateway != nil && s.Gateway.Usage == nil {
		s.Gateway.Usage = s.Usage
	}
	mux := s.Mux
	if mux == nil {
		mux = http.NewServeMux()
	}
	get := func(pattern string, h handler) { mux.HandleFunc("GET "+pattern, s.route(h, false)) }
	post := func(pattern string, h handler) { mux.HandleFunc("POST "+pattern, s.route(h, true)) }
	write := func(method, pattern string, h handler) { mux.HandleFunc(method+" "+pattern, s.route(h, true)) }

	get("/api/auth/session", s.session)
	post("/api/auth/password/sign-in", s.passwordSignIn)
	post("/api/auth/password/change", s.changePassword)
	post("/api/auth/sign-out", s.signOut)
	if s.Config.ServiceRole != "manage" {
		post("/api/auth/setup", s.setup)
		post("/api/auth/plugin/code", s.pluginCode)
	}
	post("/api/auth/email/send", s.sendCode)
	post("/api/auth/email/verify", s.verifyCode)
	get("/api/auth/google", s.startGoogle)
	get(auth.GoogleCallbackPath, s.googleCallback)
	// No cookie authorizes it and a code is useless without its verifier, so
	// any client may call it from anywhere, Origin or not.
	if s.Config.ServiceRole != "manage" {
		mux.HandleFunc("POST /api/auth/plugin/token", s.route(s.pluginToken, false))

		post("/api/teams", s.createTeam)
		post("/api/teams/{teamId}/providers", s.createProvider)
		post("/api/teams/{teamId}/configs", s.createConfig)
		get("/api/teams", s.listTeams)
		get("/api/teams/{teamId}", s.getTeam)
		write("DELETE", "/api/teams/{teamId}/membership", s.leaveTeam)
		post("/api/teams/{teamId}/members", s.addMember)
		write("DELETE", "/api/teams/{teamId}/members/{userId}", s.removeMember)
		post("/api/teams/{teamId}/members/{userId}/password", s.resetMemberPassword)
		post("/api/teams/{teamId}/members/{userId}/admin", s.handOverAdmin)
		get("/api/teams/{teamId}/invites", s.listInvites)
		post("/api/teams/{teamId}/invites", s.createInvite)
		write("DELETE", "/api/teams/{teamId}/invites/{id}", s.revokeInvite)
		post("/api/invites/redeem", s.redeemInvite)
		get("/api/teams/{teamId}/configs", s.listConfigs)
		write("PATCH", "/api/teams/{teamId}/configs/{id}", s.updateConfig)
		write("DELETE", "/api/teams/{teamId}/configs/{id}", s.deleteConfig)
		get("/api/teams/{teamId}/providers", s.listProviders)
		write("PUT", "/api/teams/{teamId}/providers/{id}", s.updateProvider)
		write("DELETE", "/api/teams/{teamId}/providers/{id}", s.deleteProvider)
		get("/api/teams/{teamId}/model-catalog", s.modelCatalog)
		get("/api/teams/{teamId}/model-rates/{configId}", s.getModelRate)
		write("PUT", "/api/teams/{teamId}/model-rates/{configId}", s.setModelRate)
		get("/api/teams/{teamId}/summary", s.teamSummary)
		get("/api/teams/{teamId}/usage", s.listUsage)
		get("/api/teams/{teamId}/usage/export", s.exportUsage)
		post("/api/teams/{teamId}/usage/{requestId}/resolve", s.resolveUsage)
		get("/api/teams/{teamId}/budgets", s.getBudgets)
		write("PUT", "/api/teams/{teamId}/budgets", s.setBudget)
		get("/api/teams/{teamId}/budgets/notices", s.listBudgetNotices)
		post("/api/teams/{teamId}/budgets/notices/{noticeId}/retry", s.retryBudgetNotice)
		get("/api/teams/{teamId}/history", s.history)
		post("/api/teams/{teamId}/history/{id}/restore", s.restoreRevision)
		get("/api/teams/{teamId}/history/{id}/export", s.exportRevision)
		post("/api/teams/{teamId}/artifacts", s.uploadArtifact)
		get("/api/teams/{teamId}/artifacts/{id}", s.artifactInfo)
		get("/api/teams/{teamId}/artifacts/{id}/download", s.downloadArtifact)
		get("/api/teams/{teamId}/submissions/{id}", s.getSubmission)
		get("/api/teams/{teamId}/submissions", s.listSubmissions)
		post("/api/teams/{teamId}/submissions", s.saveSubmission)
		write("PUT", "/api/teams/{teamId}/submissions/{id}", s.saveSubmission)
		post("/api/teams/{teamId}/submissions/{id}/{action}", s.decideSubmission)
		get("/api/profile", s.getProfile)
		write("PATCH", "/api/profile", s.updateProfile)
		write("DELETE", "/api/profile", s.deleteAccount)
		post("/api/locale", s.chooseLocale)
		get("/api/configs", s.configs)
		post("/api/llm/chat/completions", s.completions)

	}

	// An /api address no route claims answers in the API's shape, not as a page.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	})
	if s.Web != nil && !s.ManageRoot {
		if s.Config.ServiceRole == "manage" {
			mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/", "/teams":
					http.Redirect(w, r, "/manage/", http.StatusFound)
				case "/sign-in", "/setup", "/password":
					s.Web.ServeHTTP(w, r)
				default:
					if len(r.URL.Path) > 8 && r.URL.Path[:8] == "/assets/" {
						s.Web.ServeHTTP(w, r)
					} else {
						http.NotFound(w, r)
					}
				}
			}))
		} else {
			mux.Handle("/", s.Web)
		}
	}
	// Security headers go on everything, the www/apex redirect included, so the
	// twin host records HSTS too.
	return recoverer(headers(s.secure(), web.CanonicalHost(s.Config.AppURL, mux)))
}

// headers are the ones every answer carries. HSTS only where APP_URL is
// https, and without `preload`: that is a one-way door, added once the domain
// layout has settled. Framing is refused outright: no page of this site is
// meant to be shown inside another, this one's included.
func headers(secure bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		if secure {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
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
