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
	"io"
	"io/fs"
	"net/http"
	"sync"
	"time"
)

// Identity is who a request or a token is: the account, its email, and the
// door the session came through ("google", "email" or "password").
type Identity struct {
	// SessionID identifies exactly this login, including credentials issued before
	// editions used session-bound grants. Neither field is a client credential.
	SessionID      string    `json:"-"`
	SessionIssued  time.Time `json:"-"`
	SessionExpires time.Time `json:"-"`
	UserID         string
	Email          string
	Via            string
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

// SignInGate adds a second verification step after primary authentication.
type SignInGate interface {
	Required(ctx context.Context, user, entry string) (bool, error)
	ConsumeAppProof(ctx context.Context, user, session, challenge string) (bool, error)
}

type Host struct {
	AppLogin           func(*http.Request, string) (*Identity, error)
	OnSignOut          func(func(context.Context, *Identity) error)
	RegisterSignInGate func(SignInGate)
	PendingLogin       func(*http.Request) (*Identity, error)
	CompleteLogin      func(http.ResponseWriter, *http.Request) error
	ServiceRole        string
	AddAdminRoutes     func([]AdminRoute)
	SetAdminConsole    func(AdminConsole)
	SetWebConsole      func(fs.FS)

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
	// MintHostToken seals a token for a shared DSH (ADR 0047): one shared
	// host of one team, no person, for at most an hour, accepted only by
	// GET /api/configs and the model gateway, where its calls are the team's
	// and no member's. The edition checks the host is the team's and not
	// revoked before it mints; the team must exist.
	MintHostToken func(ctx context.Context, hostID, teamID string, ttl time.Duration) (string, time.Time, error)
	// GateTeamDSH lets an edition decide which teams may run a Team DSH
	// (docs/tech/shared-dsh.md, "Who may run one"): allowed answers for one
	// team, read on every request that needs it. Mount-only, at most once;
	// without a gate every team may, as on a self-hosted server.
	GateTeamDSH func(allowed func(ctx context.Context, teamID string) (bool, error)) error
	// ServeSubdomains sends every request whose Host is a subdomain of domain
	// (one label or more before it) to h, ahead of the canonical-host redirect
	// and every route; the security headers still apply. Mount-only, once per
	// domain, which must be neither APP_URL's host nor one of its parents: it
	// is for pages a closed edition serves from origins of their own (the
	// premium edition's ADR 0053).
	ServeSubdomains func(domain string, h http.Handler) error
	// TeamDSHAllowed asks that gate about one team: true where none is set.
	TeamDSHAllowed func(ctx context.Context, teamID string) (bool, error)
	// Objects keeps an extension's bytes under a team, in the server's own
	// store; nil on a management process, which has none.
	Objects Objects
	// SameOrigin reports whether r, a write, came from this site.
	SameOrigin func(r *http.Request) bool
	Users      Users
	Env        func(string) string
	// Seal keeps one of this extension's own secrets (a supplier's key) at
	// rest under PROVIDER_KEYS_SECRET, bound to the extension and the name it
	// gives, so a sealed value stored under another name no longer opens.
	// Unseal is its inverse, provider_keys_unavailable under another secret.
	Seal   func(name, secret string) string
	Unseal func(name, sealed string) (string, error)
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
	// SubscribeTeams runs inside a team creation, a member join, a team's
	// deletion, an account's, or an admin removing an owned model (TeamChange). Handlers access only their own tables, perform no
	// network I/O, and return errors to roll back the change and theirs.
	// Mount-only.
	SubscribeTeams func(TeamChangeHandler) error
}

// TeamChange identifies a real committed transition, never a browser claim.
// Creation includes the creator's initial membership; it emits no separate join.
// Deleting an account emits TeamDeleted for each team it was alone in, then
// AccountDeleted with no TeamID; an admin deleting a team emits TeamDeleted
// alone, its members still in it until the transaction commits. A handler
// that returns an error refuses the deletion, and one that hears
// AccountDeleted removes what it keeps for that account. An admin removing an
// owned model (FundingHost.PublishModel) from a team emits ModelRemoved with
// its ConfigID, after the configuration is gone; its owner forgets the route,
// and publishing it again adds it back.
type TeamChange struct {
	Kind, TeamID, UserID, ActorID string
	// ConfigID is the removed configuration, for ModelRemoved only.
	ConfigID string
}

const (
	TeamCreated    = "created"
	MemberJoined   = "joined"
	TeamDeleted    = "deleted"
	AccountDeleted = "account_deleted"
	ModelRemoved   = "model_removed"
)

type TeamChangeHandler func(context.Context, SQLExecutor, TeamChange) error

// Objects is the server's object store as an extension uses it: the local
// data directory, or the bucket ARTIFACT_STORAGE_PROVIDER=s3 names, the same
// one that holds plugin archives. An object is named by its team, a kind the
// extension owns (lower-case, not "plugins") and an id of at most 32
// characters from [A-Za-z0-9_-]. The server keeps no record of them: the
// extension's own tables say what exists, and the extension deletes what it
// stored (ADR 0042).
type Objects interface {
	// Put writes size bytes of body, replacing any object of that name.
	Put(ctx context.Context, teamID, kind, id string, body io.ReadSeeker, size int64) error
	// Open reads an object; one that does not exist is fs.ErrNotExist.
	Open(ctx context.Context, teamID, kind, id string) (io.ReadCloser, error)
	// Delete removes an object; one already gone is not an error.
	Delete(ctx context.Context, teamID, kind, id string) error
}

// Extension is one closed feature.
type Extension struct {
	// Name prefixes its migrations' versions; short, lower-case, unique.
	Name string
	// Migrations holds a directory of .sql files per dialect, named sqlite,
	// postgres and mysql; nil for none. A dialect without its directory is
	// one the edition does not run on: the binary refuses to start there,
	// and editiontest skips it.
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
