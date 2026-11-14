package db

import "testing"

func TestResolve(t *testing.T) {
	cases := []struct{ url, dialect, dsn string }{
		{"", "sqlite3", "file:/data/db.sqlite?" + SQLitePragmas},
		{"sqlite:///srv/x.sqlite", "sqlite3", "file:/srv/x.sqlite?" + SQLitePragmas},
		{"postgres://u:p@h:5432/d?sslmode=disable", "postgres", "postgres://u:p@h:5432/d?sslmode=disable"},
		{"mysql://u:p%40ss@h/d", "mysql", "u:p@ss@tcp(h:3306)/d?charset=utf8mb4&loc=UTC&parseTime=true"},
	}
	for _, c := range cases {
		got, err := Resolve(c.url, "/data")
		if err != nil {
			t.Fatalf("%q: %v", c.url, err)
		}
		if got.Dialect != c.dialect || got.DSN != c.dsn {
			t.Errorf("%q: got %s %s", c.url, got.Dialect, got.DSN)
		}
	}
	if _, err := Resolve("redis://x", ""); err == nil {
		t.Error("an unknown scheme was accepted")
	}
}
