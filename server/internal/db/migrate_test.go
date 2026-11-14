package db_test

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestMigrateIsIdempotentAndAppendOnly(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		// A second start applies nothing and fails nothing.
		if err := db.Migrate(ctx, d.SQL, d.Dialect()); err != nil {
			t.Fatalf("second run: %v", err)
		}
		var n int
		if err := d.SQL.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&n); err != nil || n == 0 {
			t.Fatalf("recorded %d migrations: %v", n, err)
		}
		// A recorded migration whose file changed stops the start.
		q := "UPDATE schema_migrations SET checksum = 'edited'"
		if _, err := d.SQL.Exec(q); err != nil {
			t.Fatal(err)
		}
		if err := db.Migrate(ctx, d.SQL, d.Dialect()); err == nil {
			t.Fatal("an edited migration was accepted")
		}
	})
}

// A closed edition's set without this dialect's directory stops the start,
// rather than serving without its tables.
func TestMigrateRefusesASetMissingTheDialect(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		only := map[string]string{"sqlite": "postgres", "postgres": "mysql", "mysql": "sqlite"}[d.Name]
		set := db.Set{Name: "probe", FS: fstest.MapFS{only + "/20260101000000_init.sql": {Data: []byte("SELECT 1;\n")}}}
		err := db.Migrate(context.Background(), d.SQL, d.Target.Dialect, set)
		if err == nil || !strings.Contains(err.Error(), "probe has no migrations") {
			t.Fatalf("got %v", err)
		}
	})
}
