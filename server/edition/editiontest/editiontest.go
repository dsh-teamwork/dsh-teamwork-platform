// Package editiontest runs a closed edition's tests against the real server:
// the open server with the extensions under test mounted, over a fresh
// database of each dialect the open suites reach (SQLite always; Postgres and
// MySQL when TEST_POSTGRES_URL and TEST_MYSQL_URL are set) that every
// extension under test has migrations for.
package editiontest

import (
	"bytes"
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/app"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Secret is the instance's AUTH_SECRET.
const Secret = "editiontest-auth-secret-at-least-32-characters"

// Instance is one running server.
type Instance struct {
	// Dialect is "sqlite", "postgres" or "mysql".
	Dialect string
	// URL is the server's address, which is also its APP_URL.
	URL string
	// SQL is its database.
	SQL *sql.DB
	t   *testing.T
	srv *httpapi.Server
}

// Options shape an instance; the zero value is a server with nothing set.
type Options struct {
	// Env is what the extensions read through Host.Env.
	Env map[string]string
	// Upstream replaces only inference transport, for extension accounting
	// integration tests. Authentication, budgets and routing remain real.
	Upstream http.RoundTripper
}

// Each runs f once per reachable dialect, as a subtest named after it, on a
// server with exts mounted and their migrations applied. A dialect one of the
// extensions has no migrations for is skipped: the binary refuses to start on
// it (db.Migrate), so there is nothing to test.
func Each(t *testing.T, exts []edition.Extension, o Options, f func(t *testing.T, in *Instance)) {
	t.Helper()
	var sets []db.Set
	for _, e := range exts {
		if e.Migrations != nil {
			sets = append(sets, db.Set{Name: e.Name, FS: e.Migrations})
		}
	}
	for _, name := range []string{"sqlite", "postgres", "mysql"} {
		t.Run(name, func(t *testing.T) {
			for _, set := range sets {
				if _, err := fs.Stat(set.FS, name); err != nil {
					t.Skipf("%s: %s has no migrations for it", name, set.Name)
				}
			}
			d := testdb.New(t, name, sets...)
			if d == nil {
				t.Skipf("%s: TEST_%s_URL is not set", name, strings.ToUpper(name))
			}
			ts := httptest.NewUnstartedServer(nil)
			cfg := config.Config{
				AppURL:             "http://" + ts.Listener.Addr().String(),
				AuthSecret:         Secret,
				ProviderKeysSecret: bytes.Repeat([]byte{7}, 32),
			}
			env := func(k string) string { return o.Env[k] }
			srv, handler, stop, err := app.Build(cfg, d.Client, d.SQL, d.Target.Dialect, exts, env)
			if err != nil {
				t.Fatal(err)
			}
			if o.Upstream != nil {
				srv.Gateway.Client = &http.Client{Transport: o.Upstream}
			}
			ts.Config.Handler = handler
			ts.Start()
			// The server goes first, then what the extensions hold, and the
			// database last (testdb's cleanup, registered before this one):
			// as the binary shuts down.
			t.Cleanup(func() { ts.Close(); stop() })
			f(t, &Instance{Dialect: name, URL: cfg.AppURL, SQL: d.SQL, t: t, srv: srv})
		})
	}
}

// Account creates an account for email and returns its id.
func (in *Instance) Account(email string) string {
	in.t.Helper()
	u, err := in.srv.Auth.DB.User.Create().SetEmail(email).Save(context.Background())
	if err != nil {
		in.t.Fatal(err)
	}
	return u.ID
}

// Team creates a team with the account as its admin, and returns its id.
func (in *Instance) Team(userID string) string {
	in.t.Helper()
	created, err := in.srv.Team.CreateTeam(context.Background(), userID, wire.CreateTeam{Name: "Team"}, "en")
	if err != nil {
		in.t.Fatal(err)
	}
	return created.ID
}

// Member adds an existing test account to a team. The extension's requests
// still exercise the real, unmodified session and role checks.
func (in *Instance) Member(teamID, userID string) {
	in.t.Helper()
	if err := in.srv.Team.DB.Membership.Create().SetTeamID(teamID).SetUserID(userID).SetRole(membership.RoleMember).Exec(context.Background()); err != nil {
		in.t.Fatal(err)
	}
}

// Bearer is a token for the account, as the plugin and the app hold one.
func (in *Instance) Bearer(userID string) string {
	in.t.Helper()
	token, _, err := in.srv.Auth.IssueBearer(context.Background(), userID, "password")
	if err != nil {
		in.t.Fatal(err)
	}
	return token
}

// FirstPassword gives the account a password a team admin set, which its
// owner must change before anything else opens.
func (in *Instance) FirstPassword(userID string) {
	in.t.Helper()
	if err := in.srv.Auth.SetPassword(context.Background(), userID, "a first password", true); err != nil {
		in.t.Fatal(err)
	}
}

// Session is a browser's session cookie for the account, through door via.
func (in *Instance) Session(userID, via string) *http.Cookie {
	in.t.Helper()
	token, _, err := in.srv.Auth.Sealer.Seal(auth.Session, auth.Claims{Sub: userID, Via: via}, auth.SessionTTL)
	if err != nil {
		in.t.Fatal(err)
	}
	return &http.Cookie{Name: "dsh-teamwork-session", Value: token}
}
