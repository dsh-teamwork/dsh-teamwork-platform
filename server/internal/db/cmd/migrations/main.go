// Command migrations writes a migration for every dialect from the schema, or
// checks that the committed history still produces it.
//
//	go run ./internal/db/cmd/migrations new <name>
//	go run ./internal/db/cmd/migrations check
//
// Both replay the history into scratch databases: SQLite in memory, and the
// Postgres and MySQL databases named by MIGRATE_DEV_POSTGRES and
// MIGRATE_DEV_MYSQL, which this command empties. `check` fails when the
// schema has a change no migration holds, as `db:drift` did for Prisma.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	atlas "ariga.io/atlas/sql/migrate"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/sql/schema"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/stdlib"
	"modernc.org/sqlite"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/migrate"
)

// Atlas opens a dev database by these driver names. This command does not
// import internal/db, which embeds the very directories it writes.
func init() {
	sql.Register("sqlite3", &sqlite.Driver{})
	sql.Register("postgres", stdlib.GetDefaultDriver())
}

// dirs is internal/db.Dirs.
var dirs = map[string]string{dialect.SQLite: "sqlite", dialect.Postgres: "postgres", dialect.MySQL: "mysql"}

func main() {
	if len(os.Args) < 2 || (os.Args[1] == "new" && len(os.Args) != 3) || (os.Args[1] != "new" && os.Args[1] != "check") {
		fmt.Fprintln(os.Stderr, "usage: migrations new <name> | migrations check")
		os.Exit(2)
	}
	devs := map[string]string{
		dialect.SQLite:   "sqlite://dev?mode=memory&_pragma=foreign_keys(1)",
		dialect.Postgres: os.Getenv("MIGRATE_DEV_POSTGRES"),
		dialect.MySQL:    os.Getenv("MIGRATE_DEV_MYSQL"),
	}
	failed := false
	for _, d := range []string{dialect.SQLite, dialect.Postgres, dialect.MySQL} {
		if devs[d] == "" {
			fmt.Fprintf(os.Stderr, "%s: MIGRATE_DEV_%s is not set\n", d, map[string]string{dialect.Postgres: "POSTGRES", dialect.MySQL: "MYSQL"}[d])
			os.Exit(2)
		}
		dir := filepath.Join("internal", "db", "migrations", dirs[d])
		var err error
		if os.Args[1] == "new" {
			err = diff(dir, d, devs[d], os.Args[2])
		} else {
			err = check(dir, d, devs[d])
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", d, err)
			failed = true
			continue
		}
		fmt.Printf("%s: ok\n", d)
	}
	if failed {
		os.Exit(1)
	}
}

func diff(dir, d, dev, name string) error {
	local, err := atlas.NewLocalDir(dir)
	if err != nil {
		return err
	}
	return migrate.NamedDiff(context.Background(), dev, name,
		schema.WithDir(local), schema.WithMigrationMode(schema.ModeReplay),
		schema.WithDialect(d), schema.WithFormatter(atlas.DefaultFormatter))
}

// check diffs into a copy of the history; any file written there is drift.
func check(dir, d, dev string) error {
	tmp, err := os.MkdirTemp("", "migrations-check-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(tmp, e.Name()), b, 0o644); err != nil {
			return err
		}
	}
	if err := diff(tmp, d, dev, "drift"); err != nil {
		return err
	}
	after, err := os.ReadDir(tmp)
	if err != nil {
		return err
	}
	if len(after) != len(entries) {
		return fmt.Errorf("the schema has changes no migration holds; run `go run ./internal/db/cmd/migrations new <name>`")
	}
	return nil
}
