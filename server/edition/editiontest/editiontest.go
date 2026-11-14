// Package editiontest runs a closed edition's tests against the real server:
// the open server with the extensions under test mounted, over a fresh
// database of each dialect the open suites reach (SQLite always; Postgres and
// MySQL when TEST_POSTGRES_URL and TEST_MYSQL_URL are set).
package editiontest

import (
	"bytes"
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/app"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/config"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/httpapi"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
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
}

// Each runs f once per reachable dialect, as a subtest named after it, on a
// server with exts mounted and their migrations applied.
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
			d := testdb.New(t, name, sets...)
			if d == nil {
				t.Skipf("%s: TEST_%s_URL is not set", name, strings.ToUpper(name))
			}
			ctx, cancel := context.WithCancel(context.Background())
			ts := httptest.NewUnstartedServer(nil)
			cfg := config.Config{
				AppURL:             "http://" + ts.Listener.Addr().String(),
				AuthSecret:         Secret,
				ProviderKeysSecret: bytes.Repeat([]byte{7}, 32),
			}
			env := func(k string) string { return o.Env[k] }
			srv, handler, err := app.Build(ctx, cfg, d.Client, d.SQL, d.Target.Dialect, exts, env)
			if err != nil {
				cancel()
				t.Fatal(err)
			}
			ts.Config.Handler = handler
			ts.Start()
			// The server goes first, then what the extensions hold: as the
			// binary shuts down.
			t.Cleanup(func() { cancel(); ts.Close() })
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

// Bearer is a token for the account, as the plugin and the app hold one.
func (in *Instance) Bearer(userID string) string {
	in.t.Helper()
	token, _, err := in.srv.Auth.Sealer.Seal(auth.PluginBearer, auth.Claims{Sub: userID, Via: "password"}, auth.SessionTTL)
	if err != nil {
		in.t.Fatal(err)
	}
	return token
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
