package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"time"

	"ariga.io/atlas/sql/migrate"
	"entgo.io/ent/dialect"
)

// The committed history, one directory per dialect, appended to and never
// edited once a database somebody else runs has applied a file.
//
//go:embed migrations
var migrations embed.FS

// Dirs maps a dialect to its directory under migrations/.
var Dirs = map[string]string{dialect.SQLite: "sqlite", dialect.Postgres: "postgres", dialect.MySQL: "mysql"}

// Set is a closed edition's own migrations (server/edition): a directory per
// dialect, named as Dirs names them, applied after the open history and
// recorded under "<Name>:<version>", so the two histories never collide.
type Set struct {
	Name string
	FS   fs.FS
}

type migration struct {
	version, name, checksum string
	stmts                   []string
}

func load(d string) ([]migration, error) {
	return loadDir(migrations, "migrations/"+Dirs[d], "")
}

func loadDir(fsys fs.FS, dir, prefix string) ([]migration, error) {
	names, err := fs.Glob(fsys, dir+"/*.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	out := make([]migration, 0, len(names))
	for _, n := range names {
		body, err := fs.ReadFile(fsys, n)
		if err != nil {
			return nil, err
		}
		stmts, err := migrate.NewLocalFile(path.Base(n), body).Stmts()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", n, err)
		}
		sum := sha256.Sum256(body)
		base := strings.TrimSuffix(path.Base(n), ".sql")
		version, _, _ := strings.Cut(base, "_")
		out = append(out, migration{version: prefix + version, name: prefix + base, checksum: hex.EncodeToString(sum[:]), stmts: stmts})
	}
	return out, nil
}

// Migrate applies the migrations the database has not recorded, in order,
// each recorded in schema_migrations with its checksum. A recorded migration
// whose file has changed since stops the start: the history is append-only.
// Several processes starting at once against Postgres or MySQL take turns
// under a lock held for the run; SQLite has one process per file. Each of
// extra follows the open history, in the order given.
func Migrate(ctx context.Context, conn *sql.DB, d string, extra ...Set) error {
	all, err := load(d)
	if err != nil {
		return err
	}
	for _, set := range extra {
		more, err := loadDir(set.FS, Dirs[d], set.Name+":")
		if err != nil {
			return fmt.Errorf("migrate: %s: %w", set.Name, err)
		}
		all = append(all, more...)
	}
	c, err := conn.Conn(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	unlock, err := lock(ctx, c, d)
	if err != nil {
		return fmt.Errorf("migrate: lock: %w", err)
	}
	defer unlock()

	if _, err := c.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version VARCHAR(32) NOT NULL PRIMARY KEY,
		name VARCHAR(255) NOT NULL,
		checksum VARCHAR(64) NOT NULL,
		applied_at VARCHAR(40) NOT NULL)`); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	applied := map[string]string{}
	rows, err := c.QueryContext(ctx, "SELECT version, checksum FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	for rows.Next() {
		var v, sum string
		if err := rows.Scan(&v, &sum); err != nil {
			rows.Close()
			return err
		}
		applied[v] = sum
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, m := range all {
		if sum, ok := applied[m.version]; ok {
			if sum != m.checksum {
				return fmt.Errorf("migrate: %s changed after it was applied; the history is append-only", m.name)
			}
			continue
		}
		if err := apply(ctx, c, d, m); err != nil {
			return fmt.Errorf("migrate: %s: %w", m.name, err)
		}
	}
	return nil
}

func apply(ctx context.Context, c *sql.Conn, d string, m migration) error {
	record := func(exec func(context.Context, string, ...any) (sql.Result, error)) error {
		q := "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)"
		if d == dialect.Postgres {
			q = "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ($1, $2, $3, $4)"
		}
		_, err := exec(ctx, q, m.version, m.name, m.checksum, time.Now().UTC().Format(time.RFC3339Nano))
		return err
	}
	if d == dialect.MySQL {
		// MySQL commits DDL as it goes, so a transaction would not hold it.
		for _, s := range m.stmts {
			if _, err := c.ExecContext(ctx, s); err != nil {
				return err
			}
		}
		return record(c.ExecContext)
	}
	tx, err := c.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, s := range m.stmts {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := record(tx.ExecContext); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func lock(ctx context.Context, c *sql.Conn, d string) (func(), error) {
	switch d {
	case dialect.Postgres:
		if _, err := c.ExecContext(ctx, "SELECT pg_advisory_lock(hashtext('dsh-teamwork:migrate'))"); err != nil {
			return nil, err
		}
		return func() {
			c.ExecContext(context.Background(), "SELECT pg_advisory_unlock(hashtext('dsh-teamwork:migrate'))")
		}, nil
	case dialect.MySQL:
		var got sql.NullInt64
		if err := c.QueryRowContext(ctx, "SELECT GET_LOCK('dsh-teamwork:migrate', 120)").Scan(&got); err != nil {
			return nil, err
		}
		if got.Int64 != 1 {
			return nil, fmt.Errorf("another process held the migration lock for two minutes")
		}
		return func() { c.ExecContext(context.Background(), "SELECT RELEASE_LOCK('dsh-teamwork:migrate')") }, nil
	default:
		return func() {}, nil
	}
}
