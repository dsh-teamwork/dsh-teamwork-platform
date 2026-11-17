// Package edition is how a closed edition extends the server without the open
// tree knowing it (ADR 0014; docs/tech/go-server.md, phase 5). A closed
// package calls Register from its init, and the closed binary's main imports
// it for that effect; the open binary imports none, so nothing is registered
// and the server is the community edition.
//
// What an extension gets is Host: the database the server opened, the way the
// server verifies who a request or a token is, and the settings it shares.
// What it brings is its own migrations, applied after the open ones, and its
// own routes on the server's mux, which the server's security headers and
// panic recovery wrap like every other route.
package edition

import (
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"sync"
	"time"
)

// Identity is who a request or a token is: the account, its email, and the
// door the session came through ("google", "email" or "password").
type Identity struct {
	UserID string
	Email  string
	Via    string
}

// User is an account, as an operator lists it.
type User struct {
	ID        string
	Email     string
	Name      *string
	Locale    *string
	CreatedAt time.Time
}

// Users is the account table as a closed console needs it; the open server
// implements it over its own schema, so a closed package never queries an
// open table.
type Users interface {
	// List is one page of accounts, newest first. q, when not empty, keeps
	// those whose email or name contains it, ignoring case.
	List(ctx context.Context, q string, page, size int) (users []User, total int, err error)
	// Count is how many accounts were created at or after since; the zero
	// time counts them all.
	Count(ctx context.Context, since time.Time) (int, error)
	// Rename sets an account's display name, nil clearing it; found is false
	// when no account has that id.
	Rename(ctx context.Context, id string, name *string) (found bool, err error)
	// InTeam reports whether the account is a member of any team.
	InTeam(ctx context.Context, id string) (bool, error)
}

// Host is what the server lends an extension.
type AdminRoute struct {
	Method      string                                                 `json:"method"`
	Path        string                                                 `json:"path"`
	Access      string                                                 `json:"access"`
	Description string                                                 `json:"description"`
	Query       map[string]any                                         `json:"query,omitempty"`
	Body        map[string]any                                         `json:"body,omitempty"`
	Response    map[string]any                                         `json:"response"`
	GoogleOnly  bool                                                   `json:"-"`
	Handle      func(http.ResponseWriter, *http.Request, string) error `json:"-"`
}

// AdminConsole replaces the community assets while retaining its API and guard.
//
// SetWebConsole is its counterpart for everything else a browser loads: the
// edition's web app build (premium/apps/web), laid out as apps/web's is, which
// composes the open app and adds or replaces pages; the server still decides
// which page answers which path (server/internal/web).
type AdminConsole struct {
	Files      fs.FS
	Base       string
	GoogleOnly bool
}

type Host struct {
	ServiceRole     string
	AddAdminRoutes  func([]AdminRoute)
	SetAdminConsole func(AdminConsole)
	SetWebConsole   func(fs.FS)

	// DB is the server's connection, and Dialect its kind: "sqlite3",
	// "postgres" or "mysql". The extension's own tables are there.
	DB      *sql.DB
	Dialect string
	// AppURL is the site's address, without a trailing slash.
	AppURL string
	// AuthSecret is the server's AUTH_SECRET, for an extension that keys an
	// HMAC with it as sign-in codes are.
	AuthSecret string
	// Mux is the server's router; Handle and HandleFunc add routes to it.
	Mux *http.ServeMux
	// Bearer opens a token the plugin or the app holds: its account, or nil
	// for a token that does not open or whose account is gone.
	Bearer func(ctx context.Context, token string) (*Identity, error)
	// Session is the browser's session on r, or nil.
	Session func(r *http.Request) (*Identity, error)
	// MintComputerToken seals a token for the plugin in a cloud computer
	// (ADR 0038): one member of one team, for at most an hour, accepted only by
	// GET /api/configs and the model gateway. host names the computer or
	// session it is for. The member must be in the team.
	MintComputerToken func(ctx context.Context, userID, teamID, host string, ttl time.Duration) (string, time.Time, error)
	// SameOrigin reports whether r, a write, came from this site.
	SameOrigin func(r *http.Request) bool
	Users      Users
	Env        func(string) string
	// TeamRole re-reads one membership. An outsider gets the public 404 error.
	TeamRole   func(context.Context, string, string, bool) (string, error)
	TeamExists func(context.Context, string) (bool, error)
	// RegisterFunding binds protected models to this extension. Called once
	// during Mount, before serving; community code needs no participant.
	RegisterFunding func(ModelFunding) (FundingHost, error)
	// RegisterMeters adds this extension's meters to the public usage and
	// budget engine (ADR 0036). Called once during Mount, before serving.
	RegisterMeters func([]Meter, MeterFunding) (MeterHost, error)
	// Operator-only recovery. Team APIs never receive this capability.
	ResolveFundingUsage func(context.Context, string, string, string, string, string, Tokens) error
	WithTeamTx          func(context.Context, string, func(SQLExecutor) error) error
	// SubscribeTeams runs inside a team creation, a member join or an account
	// deletion (TeamChange). Handlers access only their own tables, perform no
	// network I/O, and return errors to roll back the change and theirs.
	// Mount-only.
	SubscribeTeams func(TeamChangeHandler) error
}

// TeamChange identifies a real committed transition, never a browser claim.
// Creation includes the creator's initial membership; it emits no separate join.
// Deleting an account emits TeamDeleted for each team it was alone in, then
// AccountDeleted with no TeamID; a handler that returns an error refuses the
// deletion, and one that hears AccountDeleted removes what it keeps for that
// account.
type TeamChange struct {
	Kind, TeamID, UserID, ActorID string
}

const (
	TeamCreated    = "created"
	MemberJoined   = "joined"
	TeamDeleted    = "deleted"
	AccountDeleted = "account_deleted"
)

type TeamChangeHandler func(context.Context, SQLExecutor, TeamChange) error

// Extension is one closed feature.
type Extension struct {
	// Name prefixes its migrations' versions; short, lower-case, unique.
	Name string
	// Migrations holds a directory of .sql files per dialect, named sqlite,
	// postgres and mysql; nil for none.
	Migrations fs.FS
	// Mount adds the extension's routes once the server is ready to serve. It
	// returns stop, called once the server has stopped taking requests and
	// before the database closes: it ends what the extension holds (sockets,
	// goroutines) and returns when they have let go. nil for nothing to stop.
	Mount func(h Host) (stop func(), err error)
}

var (
	mu         sync.Mutex
	extensions []Extension
)

// Register adds an extension. It is called from a closed package's init.
func Register(e Extension) {
	mu.Lock()
	defer mu.Unlock()
	extensions = append(extensions, e)
}

// Registered is every extension, in the order registered.
func Registered() []Extension {
	mu.Lock()
	defer mu.Unlock()
	return append([]Extension(nil), extensions...)
}
