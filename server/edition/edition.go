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
}

// Host is what the server lends an extension.
type Host struct {
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
	// SameOrigin reports whether r, a write, came from this site.
	SameOrigin func(r *http.Request) bool
	Users      Users
	Env        func(string) string
	// Done is closed when the server begins to shut down.
	Done <-chan struct{}
}

// Extension is one closed feature.
type Extension struct {
	// Name prefixes its migrations' versions; short, lower-case, unique.
	Name string
	// Migrations holds a directory of .sql files per dialect, named sqlite,
	// postgres and mysql; nil for none.
	Migrations fs.FS
	// Mount adds the extension's routes once the server is ready to serve.
	Mount func(h Host) error
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
