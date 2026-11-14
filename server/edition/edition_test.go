package edition_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

// probe is an extension as a closed package writes one: a table of its own,
// and a route that says who called it.
func probe(host *edition.Host) edition.Extension {
	table := "CREATE TABLE probe_notes (id VARCHAR(21) NOT NULL PRIMARY KEY);\n"
	return edition.Extension{
		Name: "probe",
		Migrations: fstest.MapFS{
			"sqlite/20260101000000_init.sql":   {Data: []byte(table)},
			"postgres/20260101000000_init.sql": {Data: []byte(table)},
			"mysql/20260101000000_init.sql":    {Data: []byte(table)},
		},
		Mount: func(h edition.Host) error {
			*host = h
			h.Mux.HandleFunc("GET /probe", func(w http.ResponseWriter, r *http.Request) {
				var who *edition.Identity
				var err error
				if b, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
					who, err = h.Bearer(r.Context(), b)
				} else {
					who, err = h.Session(r)
				}
				if err != nil {
					http.Error(w, err.Error(), 500)
					return
				}
				json.NewEncoder(w).Encode(who)
			})
			return nil
		},
	}
}

func call(t *testing.T, in *editiontest.Instance, set func(*http.Request)) *edition.Identity {
	t.Helper()
	req, _ := http.NewRequest("GET", in.URL+"/probe", nil)
	set(req)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("probe: %d, headers %v", res.StatusCode, res.Header)
	}
	var who *edition.Identity
	json.NewDecoder(res.Body).Decode(&who)
	return who
}

func TestExtension(t *testing.T) {
	var host edition.Host
	editiontest.Each(t, []edition.Extension{probe(&host)}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ctx := context.Background()
		// Its migration ran, recorded under its own name.
		var name string
		if err := in.SQL.QueryRowContext(ctx, "SELECT name FROM schema_migrations WHERE version = 'probe:20260101000000'").Scan(&name); err != nil || name != "probe:20260101000000_init" {
			t.Fatalf("recorded %q, %v", name, err)
		}
		if _, err := in.SQL.ExecContext(ctx, "INSERT INTO probe_notes (id) VALUES ('a')"); err != nil {
			t.Fatal(err)
		}

		ada := in.Account("ada@example.com")
		if who := call(t, in, func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+in.Bearer(ada)) }); who == nil || who.UserID != ada || who.Email != "ada@example.com" {
			t.Fatalf("bearer: %+v", who)
		}
		if who := call(t, in, func(r *http.Request) { r.AddCookie(in.Session(ada, "google")) }); who == nil || who.Via != "google" {
			t.Fatalf("session: %+v", who)
		}
		// A session cookie is not a Bearer token, and a Bearer is not a cookie.
		if who := call(t, in, func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+in.Session(ada, "google").Value) }); who != nil {
			t.Fatalf("a cookie opened as a Bearer: %+v", who)
		}
		if who := call(t, in, func(r *http.Request) { r.AddCookie(&http.Cookie{Name: "dsh-teamwork-session", Value: in.Bearer(ada)}) }); who != nil {
			t.Fatalf("a Bearer opened as a cookie: %+v", who)
		}
		if who := call(t, in, func(*http.Request) {}); who != nil {
			t.Fatalf("nobody: %+v", who)
		}

		// The accounts, as an operator console reads them.
		time.Sleep(10 * time.Millisecond)
		in.Account("Grace@Example.com")
		users, total, err := host.Users.List(ctx, "", 1, 1)
		if err != nil || total != 2 || len(users) != 1 || users[0].Email != "Grace@Example.com" {
			t.Fatalf("page 1: %+v %d %v", users, total, err)
		}
		users, total, err = host.Users.List(ctx, "grace@", 1, 50)
		if err != nil || total != 1 || users[0].Email != "Grace@Example.com" {
			t.Fatalf("search ignoring case: %+v %d %v", users, total, err)
		}
		if n, err := host.Users.Count(ctx, time.Now().Add(-time.Hour)); err != nil || n != 2 {
			t.Fatalf("count: %d %v", n, err)
		}
		name2 := "Ada L."
		if found, err := host.Users.Rename(ctx, ada, &name2); !found || err != nil {
			t.Fatalf("rename: %v %v", found, err)
		}
		if users, _, _ := host.Users.List(ctx, "ada l", 1, 50); len(users) != 1 || *users[0].Name != "Ada L." {
			t.Fatalf("by name: %+v", users)
		}
		if found, err := host.Users.Rename(ctx, ada, nil); !found || err != nil {
			t.Fatalf("clear: %v %v", found, err)
		}
		if found, err := host.Users.Rename(ctx, "nobody", nil); found || err != nil {
			t.Fatalf("unknown: %v %v", found, err)
		}
		if in, err := host.Users.InTeam(ctx, ada); in || err != nil {
			t.Fatalf("in a team before joining one: %v %v", in, err)
		}
		in.Team(ada)
		if in, err := host.Users.InTeam(ctx, ada); !in || err != nil {
			t.Fatalf("not in the team it created: %v %v", in, err)
		}
	})
}
