package db_test

import (
	"context"
	"testing"

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
