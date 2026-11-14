// Package db opens the database DATABASE_URL names — SQLite, Postgres or
// MySQL (ADR 0014) — and brings its schema up to date from the migrations
// embedded in the binary.
//
// The schema is internal/db/schema; `go run ./internal/db/cmd/migrations`
// writes a migration for each dialect from it and checks that the committed
// history still matches (docs/tech/go-server.md, "Rules for the data layer").
package db

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
)

// Target is a database to open: its dialect and the driver's own DSN.
type Target struct {
	Dialect string // dialect.SQLite, dialect.Postgres or dialect.MySQL
	Driver  string // the database/sql driver name
	DSN     string
}

// SQLitePragmas are what every SQLite connection opens with: foreign keys
// enforced, a writer waits for another instead of failing, readers do not
// block the writer, and a write transaction takes its lock at BEGIN.
const SQLitePragmas = "_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_txlock=immediate"

// Resolve reads DATABASE_URL. Empty means SQLite in dataDir.
func Resolve(databaseURL, dataDir string) (Target, error) {
	raw := strings.TrimSpace(databaseURL)
	if raw == "" {
		return sqliteTarget(filepath.Join(dataDir, "db.sqlite")), nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return Target{}, fmt.Errorf("DATABASE_URL: %w", err)
	}
	switch u.Scheme {
	case "postgres", "postgresql":
		return Target{Dialect: dialect.Postgres, Driver: "pgx", DSN: raw}, nil
	case "mysql":
		return mysqlTarget(u)
	case "sqlite", "file":
		path := u.Opaque
		if path == "" {
			path = u.Path
		}
		if path == "" {
			return Target{}, fmt.Errorf("DATABASE_URL: a sqlite URL names a file, as sqlite:///path/to/db.sqlite")
		}
		return sqliteTarget(path), nil
	default:
		return Target{}, fmt.Errorf("DATABASE_URL: unsupported scheme %q (postgres, mysql or sqlite)", u.Scheme)
	}
}

func sqliteTarget(path string) Target {
	return Target{Dialect: dialect.SQLite, Driver: "sqlite", DSN: "file:" + filepath.ToSlash(path) + "?" + SQLitePragmas}
}

// mysqlTarget turns mysql://user:pass@host:port/db?… into the driver's DSN.
// Times are read and written as UTC.
func mysqlTarget(u *url.URL) (Target, error) {
	name := strings.TrimPrefix(u.Path, "/")
	if name == "" {
		return Target{}, fmt.Errorf("DATABASE_URL: a mysql URL names its database, as mysql://user:pass@host:3306/name")
	}
	host := u.Host
	if u.Port() == "" {
		host += ":3306"
	}
	query := u.Query()
	query.Set("parseTime", "true")
	query.Set("loc", "UTC")
	query.Set("charset", "utf8mb4")
	dsn := fmt.Sprintf("tcp(%s)/%s?%s", host, name, query.Encode())
	if u.User != nil {
		// The driver reads its DSN literally, so the URL's escapes are undone.
		cred := u.User.Username()
		if pass, ok := u.User.Password(); ok {
			cred += ":" + pass
		}
		dsn = cred + "@" + dsn
	}
	return Target{Dialect: dialect.MySQL, Driver: "mysql", DSN: dsn}, nil
}

// Open connects, applies every pending migration and returns the client.
func Open(ctx context.Context, t Target) (*ent.Client, *sql.DB, error) {
	conn, err := sql.Open(t.Driver, t.DSN)
	if err != nil {
		return nil, nil, err
	}
	if t.Dialect == dialect.SQLite {
		// One writer at a time is SQLite's model; a small pool keeps readers
		// concurrent without queueing writers behind dozens of connections.
		conn.SetMaxOpenConns(8)
	}
	if err := conn.PingContext(ctx); err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("database: %w", err)
	}
	if err := Migrate(ctx, conn, t.Dialect); err != nil {
		conn.Close()
		return nil, nil, err
	}
	return ent.NewClient(ent.Driver(entsql.OpenDB(t.Dialect, conn))), conn, nil
}
