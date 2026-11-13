// Throwaway packaging experiment (docs/tech/go-server.md, experiment 3): an
// embedded page and SQLite migrations, and a self-check that applies them in a
// data directory and writes and reads a row. Deleted once the run is recorded.
package main

import (
	"database/sql"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed web
var web embed.FS

//go:embed migrations/*.sql
var migrations embed.FS

var version = "dev"

func apply(db *sql.DB) error {
	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)"); err != nil {
		return err
	}
	names, _ := fs.Glob(migrations, "migrations/*.sql")
	sort.Strings(names)
	for _, n := range names {
		v := strings.SplitN(filepath.Base(n), "_", 2)[0]
		var seen string
		if db.QueryRow("SELECT version FROM schema_migrations WHERE version = ?", v).Scan(&seen) == nil {
			continue
		}
		body, _ := migrations.ReadFile(n)
		if _, err := db.Exec(string(body)); err != nil {
			return fmt.Errorf("%s: %w", n, err)
		}
		if _, err := db.Exec("INSERT INTO schema_migrations (version) VALUES (?)", v); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	home, _ := os.UserHomeDir()
	data := flag.String("data", filepath.Join(home, ".dsh-teamwork-exp"), "data directory")
	check := flag.Bool("check", false, "self-check and exit")
	showVersion := flag.Bool("version", false, "print the version")
	flag.Parse()
	if *showVersion {
		fmt.Printf("dsh-teamwork %s %s/%s\n", version, runtime.GOOS, runtime.GOARCH)
		return
	}
	if err := os.MkdirAll(*data, 0o700); err != nil {
		log.Fatal(err)
	}
	dsn := "file:" + filepath.ToSlash(filepath.Join(*data, "db.sqlite")) +
		"?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatal(err)
	}
	if err := apply(db); err != nil {
		log.Fatal(err)
	}
	if *check {
		id := fmt.Sprintf("t%d", os.Getpid())
		if _, err := db.Exec("INSERT INTO teams (id, created_at, name) VALUES (?, CURRENT_TIMESTAMP, 'check')", id); err != nil {
			log.Fatal(err)
		}
		var n int
		db.QueryRow("SELECT count(*) FROM teams").Scan(&n)
		fmt.Printf("ok %s/%s teams=%d\n", runtime.GOOS, runtime.GOARCH, n)
		return
	}
	sub, _ := fs.Sub(web, "web")
	fmt.Println("listening on http://127.0.0.1:3900")
	log.Fatal(http.ListenAndServe("127.0.0.1:3900", http.FileServerFS(sub)))
}
