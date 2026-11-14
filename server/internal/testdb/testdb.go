// Package testdb gives a test a fresh, migrated database on each dialect it
// can reach: SQLite always, and Postgres and MySQL when TEST_POSTGRES_URL and
// TEST_MYSQL_URL name a server (CI sets both, so skipped locally never means
// skipped everywhere). Each call creates a database of its own and drops it
// when the test ends.
package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
)

// DB is one migrated database for a test.
type DB struct {
	Name   string // sqlite, postgres or mysql
	Target db.Target
	URL    string // what DATABASE_URL would say
	Client *ent.Client
	SQL    *sql.DB
}

// Each runs f once per reachable dialect, as a subtest named after it.
func Each(t *testing.T, f func(t *testing.T, d *DB)) {
	t.Helper()
	for _, name := range []string{"sqlite", "postgres", "mysql"} {
		t.Run(name, func(t *testing.T) {
			d := New(t, name)
			if d == nil {
				t.Skipf("%s: TEST_%s_URL is not set", name, strings.ToUpper(name))
			}
			f(t, d)
		})
	}
}

// New is a fresh migrated database of one dialect, or nil when it cannot be
// reached in this environment.
func New(t *testing.T, name string) *DB {
	t.Helper()
	ctx := context.Background()
	var raw string
	switch name {
	case "sqlite":
		raw = "sqlite://" + filepath.ToSlash(filepath.Join(t.TempDir(), "db.sqlite"))
	case "postgres", "mysql":
		server := os.Getenv("TEST_" + strings.ToUpper(name) + "_URL")
		if server == "" {
			return nil
		}
		raw = scratch(t, name, server)
	}
	target, err := db.Resolve(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	client, conn, err := db.Open(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	return &DB{Name: name, Target: target, URL: raw, Client: client, SQL: conn}
}

// scratch creates a database on the server and returns its URL.
func scratch(t *testing.T, name, server string) string {
	t.Helper()
	u, err := url.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	dbName := "t_" + strings.ToLower(strings.NewReplacer("-", "x", "_", "y").Replace(ids.New()))
	target, err := db.Resolve(server, "")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := sql.Open(target.Driver, target.DSN)
	if err != nil {
		t.Fatal(err)
	}
	quote := map[string]string{"postgres": `"%s"`, "mysql": "`%s`"}[name]
	if _, err := admin.Exec("CREATE DATABASE " + fmt.Sprintf(quote, dbName)); err != nil {
		t.Fatalf("%s: create database: %v", name, err)
	}
	t.Cleanup(func() {
		if name == "postgres" {
			admin.Exec(fmt.Sprintf(`DROP DATABASE IF EXISTS "%s" WITH (FORCE)`, dbName))
		} else {
			admin.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", dbName))
		}
		admin.Close()
	})
	u.Path = "/" + dbName
	return u.String()
}

// Dialect is the ent dialect name of a test database.
func (d *DB) Dialect() string { return d.Target.Dialect }
