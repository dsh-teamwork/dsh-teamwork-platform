package manage

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
)

// Mount serves the shared instance API and the selected edition console.
// Mount adds the management API and console. devOrigin, set under DEV_VITE,
// is the management Vite server the console's pages come from instead of the
// embedded build.
func Mount(h edition.Host, db *ent.Client, console edition.AdminConsole, extra []edition.AdminRoute, devOrigin string) {
	if h.ServiceRole == "user" || strings.TrimSpace(h.Env("ADMIN_EMAILS")) == "" {
		h.Mux.HandleFunc("/manage", http.NotFound)
		h.Mux.HandleFunc("/manage/", http.NotFound)
		return
	}
	a := &api{host: h, db: db, routes: append([]route{}, routes...), googleOnly: console.GoogleOnly}
	for _, e := range extra {
		a.routes = append(a.routes, route{Method: e.Method, Path: e.Path, Access: e.Access, Description: e.Description, Query: e.Query, Body: e.Body, Response: e.Response, operatorOnly: e.GoogleOnly, handle: func(_ *api, w http.ResponseWriter, r *http.Request, who actor) error {
			return e.Handle(w, r, who.label())
		}})
	}
	for _, r := range a.routes {
		if r.open != nil {
			h.Mux.HandleFunc(r.Method+" "+r.Path, func(w http.ResponseWriter, req *http.Request) { r.open(a, w, req) })
			continue
		}
		h.Mux.HandleFunc(r.Method+" "+r.Path, a.guard(r))
	}
	mountConsole(h.Mux, console, devOrigin)
}

type api struct {
	host       edition.Host
	routes     []route
	db         *ent.Client
	googleOnly bool
}

// actor is who made a request: an admin's address, or an agent's label.
type actor struct {
	email   string // a session's
	agentID string // a key's, when it named one
}

func (a actor) label() string {
	if a.email != "" {
		return a.email
	}
	if a.agentID != "" {
		return "agent/" + a.agentID
	}
	return "agent/unknown"
}

// apiError is a failure the operator is meant to read.
type apiError struct {
	status int
	code   string
	issues []issue
}

func (e *apiError) Error() string { return e.code }

type issue struct {
	Path    []string `json:"path"`
	Message string   `json:"message"`
}

func invalid(field, message string) *apiError {
	return &apiError{status: http.StatusBadRequest, code: "invalid_request", issues: []issue{{Path: []string{field}, Message: message}}}
}

// handler answers a request a guard has admitted.
type handler func(a *api, w http.ResponseWriter, r *http.Request, who actor) error

func writeJSON(w http.ResponseWriter, status int, v any) {
	// These answers are cookie-authed: no intermediary may cache them.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func (a *api) guard(r route) http.HandlerFunc {
	write := r.Method != http.MethodGet
	return func(w http.ResponseWriter, req *http.Request) {
		if write {
			// A key is not a cookie: no other site can make a browser send
			// it, so only a cookie's write must come from this site, by the
			// server's own rule.
			if _, key := presentedKey(req); !key && !a.host.SameOrigin(req) {
				fail(w, http.StatusForbidden, "cross_origin")
				return
			}
			// What actually closes CSRF: a cross-origin fetch with
			// application/json is preflighted and blocked; a form-encoded
			// "simple" request is not.
			if !strings.HasPrefix(strings.ToLower(req.Header.Get("Content-Type")), "application/json") {
				fail(w, http.StatusUnsupportedMediaType, "unsupported_media_type")
				return
			}
		}
		who, status, code := a.actor(req, write)
		if status != 0 {
			fail(w, status, code)
			return
		}
		if r.operatorOnly && !a.googleOperator(req) {
			fail(w, 403, "financial_operator_required")
			return
		}
		err := r.handle(a, w, req, who)
		var e *apiError
		var financial *edition.FundingError
		switch {
		case err == nil:
		case errors.As(err, &financial):
			fail(w, financial.Status, financial.Code)
		case errors.As(err, &e) && e.issues != nil:
			writeJSON(w, e.status, map[string]any{"error": e.code, "issues": e.issues})
		case errors.As(err, &e):
			fail(w, e.status, e.code)
		default:
			slog.Error("admin api", "path", req.URL.Path, "error", err)
			fail(w, http.StatusInternalServerError, "internal_error")
		}
	}
}

// actor is the caller, or the status and code that refuse it. The presence
// of a key header, not a session-first fallback, picks the branch, so a
// wrong key gets a straight 401 rather than falling through to the session.
func (a *api) actor(r *http.Request, write bool) (actor, int, string) {
	key, presented := presentedKey(r)
	if presented {
		expected := strings.TrimSpace(a.host.Env("MANAGE_API_KEY"))
		if expected == "" {
			// Unconfigured and wrong are different problems; the difference
			// goes to the log, not to an anonymous caller.
			slog.Error("admin api: MANAGE_API_KEY is not configured")
			return actor{}, http.StatusServiceUnavailable, "unavailable"
		}
		if key == "" || subtle.ConstantTimeCompare([]byte(key), []byte(expected)) != 1 {
			return actor{}, http.StatusUnauthorized, "unauthorized"
		}
		agent := strings.TrimSpace(r.Header.Get("x-agent-id"))
		if utf8.RuneCountInString(agent) > 100 {
			agent = ""
		}
		// Checked after the key, so an anonymous caller learns nothing from it.
		if write && agent == "" {
			return actor{}, http.StatusBadRequest, "agent_id_required"
		}
		return actor{agentID: agent}, 0, ""
	}
	email, err := a.admin(r)
	if err != nil {
		slog.Error("admin api: session", "error", err)
		return actor{}, http.StatusInternalServerError, "internal_error"
	}
	if email == "" {
		return actor{}, http.StatusUnauthorized, "unauthorized"
	}
	return actor{email: email}, 0, ""
}

// presentedKey is the key a request presents, from either header, and
// whether it presented one at all.
func presentedKey(r *http.Request) (string, bool) {
	if h := r.Header.Get("Authorization"); h != "" {
		fields := strings.Fields(h)
		if len(fields) == 2 && strings.EqualFold(fields[0], "bearer") {
			return fields[1], true
		}
		return "", true
	}
	if values, ok := r.Header["X-Api-Key"]; ok {
		return strings.TrimSpace(strings.Join(values, "")), true
	}
	return "", false
}

// signedIn is the browser's Google session on r: its address, or "".
func (a *api) signedIn(r *http.Request) (string, error) {
	who, err := a.host.Session(r)
	if err != nil || who == nil || (a.googleOnly && who.Via != "google") {
		return "", err
	}
	must, err := (&auth.Service{DB: a.db}).MustChange(r.Context(), who.UserID)
	if err != nil || must {
		return "", err
	}
	return who.Email, nil
}

// admin is the address of an admin's Google session on r, or "".
func (a *api) admin(r *http.Request) (string, error) {
	email, err := a.signedIn(r)
	if err != nil || !IsAdmin(email, a.host.Env("ADMIN_EMAILS")) {
		return "", err
	}
	return email, nil
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// IsAdmin reports whether email is in the comma-separated list.
func IsAdmin(email, list string) bool {
	email = normalizeEmail(email)
	if email == "" {
		return false
	}
	for _, e := range strings.Split(list, ",") {
		if normalizeEmail(e) == email {
			return true
		}
	}
	return false
}

// --- handlers --------------------------------------------------------------

func describe(a *api, w http.ResponseWriter, _ *http.Request, _ actor) error {
	writeJSON(w, http.StatusOK, index(a.routes))
	return nil
}

// me is who the console's pages are for: an admin's address; 401 for no
// Google session, so the page offers the Google button; 403 for a Google
// session that is not an admin, so it says to ask for the address to be
// added rather than offering a sign-in that will never work. It is not
// guarded like the rest: answering a stranger is its job.
func me(a *api, w http.ResponseWriter, r *http.Request) {
	email, err := a.signedIn(r)
	switch {
	case err != nil:
		slog.Error("admin api: session", "error", err)
		fail(w, http.StatusInternalServerError, "internal_error")
	case email == "":
		fail(w, http.StatusUnauthorized, "unauthorized")
	case !IsAdmin(email, a.host.Env("ADMIN_EMAILS")):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden", "email": email})
	default:
		writeJSON(w, http.StatusOK, map[string]string{"email": email})
	}
}

type stats struct {
	Teams     int `json:"teams"`
	Users     int `json:"users"`
	NewInWeek int `json:"newInWeek"`
}

func getStats(a *api, w http.ResponseWriter, r *http.Request, _ actor) error {
	ctx := r.Context()
	total, err := a.host.Users.Count(ctx, time.Time{})
	if err != nil {
		return err
	}
	week, err := a.host.Users.Count(ctx, time.Now().Add(-7*24*time.Hour))
	if err != nil {
		return err
	}
	teams, err := a.db.Team.Query().Count(ctx)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, stats{Users: total, NewInWeek: week, Teams: teams})
	return nil
}

type userRow struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      *string `json:"name"`
	Locale    *string `json:"locale"`
	CreatedAt string  `json:"createdAt"`
}

type usersPage struct {
	Users      []userRow `json:"users"`
	Total      int       `json:"total"`
	Page       int       `json:"page"`
	TotalPages int       `json:"totalPages"`
}

// intParam reads a whole number in [min, max], or def when it is absent.
func intParam(q url.Values, name string, def, min, max int) (int, error) {
	raw := strings.TrimSpace(q.Get(name))
	if !q.Has(name) || raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return 0, invalid(name, "a whole number from "+strconv.Itoa(min)+" to "+strconv.Itoa(max))
	}
	return n, nil
}

func listUsers(a *api, w http.ResponseWriter, r *http.Request, _ actor) error {
	q := r.URL.Query()
	page, err := intParam(q, "page", 1, 1, 1<<30)
	if err != nil {
		return err
	}
	size, err := intParam(q, "size", 50, 1, 200)
	if err != nil {
		return err
	}
	users, total, err := a.host.Users.List(r.Context(), strings.TrimSpace(q.Get("q")), page, size)
	if err != nil {
		return err
	}
	out := usersPage{Users: make([]userRow, len(users)), Total: total, Page: page, TotalPages: max(1, (total+size-1)/size)}
	for i, u := range users {
		out.Users[i] = userRow{ID: u.ID, Email: u.Email, Name: u.Name, Locale: u.Locale, CreatedAt: u.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z")}
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

func renameUser(a *api, w http.ResponseWriter, r *http.Request, who actor) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024))
	if err != nil {
		return err
	}
	var in map[string]json.RawMessage
	if json.Unmarshal(body, &in) != nil {
		return invalid("name", "a name of 1 to 80 characters, or null")
	}
	raw, ok := in["name"]
	if !ok {
		return invalid("name", "a name of 1 to 80 characters, or null")
	}
	var name *string
	if string(raw) != "null" {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return invalid("name", "a name of 1 to 80 characters, or null")
		}
		s = strings.TrimSpace(s)
		if n := utf8.RuneCountInString(s); n < 1 || n > 80 {
			return invalid("name", "a name of 1 to 80 characters, or null")
		}
		name = &s
	}
	id := r.PathValue("id")
	found, err := a.host.Users.Rename(r.Context(), id, name)
	if err != nil {
		return err
	}
	if !found {
		return &apiError{status: http.StatusNotFound, code: "not_found"}
	}
	slog.Info("admin: renamed a user", "actor", who.label(), "user", id)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name})
	return nil
}

func (a *api) googleOperator(r *http.Request) bool {
	if _, key := presentedKey(r); key {
		return false
	}
	who, err := a.host.Session(r)
	return err == nil && who != nil && who.Via == "google" && IsAdmin(who.Email, a.host.Env("ADMIN_EMAILS"))
}
