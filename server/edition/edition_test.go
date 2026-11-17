package edition_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
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
		Mount: func(h edition.Host) (func(), error) {
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
			return nil, nil
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
		// A time in another zone counts the same: the stored times are UTC.
		if n, err := host.Users.Count(ctx, time.Now().In(time.FixedZone("UTC+8", 8*3600)).Add(-time.Hour)); err != nil || n != 2 {
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

// An edition's web build replaces the embedded one whole: its own pages are
// served by the open rules, and the open build is not consulted.
func TestEditionWebConsoleReplacesTheBuild(t *testing.T) {
	page := func(id string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte(`<html lang="en"><head></head><body>` + id + `</body></html>`)}
	}
	files := fstest.MapFS{
		"index.html":                page("edition console"),
		"public/home.en.html":       page("edition home"),
		"public/pricing.en.html":    page("edition pricing"),
		"public/pricing.zh-CN.html": page("edition pricing zh"),
		"assets/edition.js":         {Data: []byte("edition")},
	}
	ext := edition.Extension{Name: "web", Mount: func(h edition.Host) (func(), error) {
		h.SetWebConsole(files)
		return nil, nil
	}}
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		for path, want := range map[string]string{"/": "edition home", "/pricing": "edition pricing", "/teams": "edition console", "/assets/edition.js": "edition"} {
			req, _ := http.NewRequest("GET", in.URL+path, nil)
			req.Header.Set("Accept-Language", "en")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != 200 || !strings.Contains(string(b), want) {
				t.Fatalf("%s: %d %s", path, res.StatusCode, b)
			}
		}
	})
}

type walletProbe struct{ reserved, settled int }

func (w *walletProbe) ReserveMeter(context.Context, edition.SQLExecutor, edition.MeterAdmission) error {
	w.reserved++
	return nil
}
func (w *walletProbe) SettleMeter(context.Context, edition.SQLExecutor, edition.MeterSettlement) error {
	w.settled++
	return nil
}

func TestEditionMetersReachTheTeamsUsage(t *testing.T) {
	var meters edition.MeterHost
	wallet := &walletProbe{}
	ext := edition.Extension{Name: "meters", Mount: func(h edition.Host) (func(), error) {
		*wallet = walletProbe{} // one per database the suite runs on
		labels := map[string]string{"en": "Cloud computer", "zh-CN": "Cloud computer"}
		var err error
		meters, err = h.RegisterMeters([]edition.Meter{{Name: "cloud.vm", Unit: "second", Labels: labels, UnitLabels: map[string]string{"en": "s", "zh-CN": "s"}}}, wallet)
		if err != nil {
			return nil, err
		}
		labels["en"] = "Mutated after registration"
		return nil, nil
	}}
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ctx := context.Background()
		ada := in.Account("ada@example.test")
		team := in.Team(ada)
		id, err := meters.Reserve(ctx, edition.MeterUse{TeamID: team, UserID: ada, Meter: "cloud.vm", Points: 1_000_000_000, For: time.Minute})
		if err != nil {
			t.Fatal(err)
		}
		if err := meters.Settle(ctx, id, 90, 250_000_000); err != nil {
			t.Fatal(err)
		}
		req, _ := http.NewRequest("GET", in.URL+"/api/teams/"+team+"/usage", nil)
		req.AddCookie(in.Session(ada, "password"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var page struct {
			Entries []struct {
				ID     string  `json:"id"`
				Points *string `json:"points"`
				Meter  *struct {
					Name     string            `json:"name"`
					Quantity int64             `json:"quantity"`
					Labels   map[string]string `json:"labels"`
				} `json:"meter"`
			} `json:"entries"`
		}
		if err := json.NewDecoder(res.Body).Decode(&page); err != nil || res.StatusCode != 200 {
			t.Fatalf("usage: %d %v", res.StatusCode, err)
		}
		if len(page.Entries) != 1 || page.Entries[0].ID != id || page.Entries[0].Meter == nil || page.Entries[0].Meter.Quantity != 90 ||
			page.Entries[0].Meter.Labels["en"] != "Cloud computer" || *page.Entries[0].Points != "0.25" || wallet.reserved != 1 || wallet.settled != 1 {
			t.Fatalf("usage page %+v, wallet %+v", page.Entries, wallet)
		}
	})
}

func TestEditionMintsComputerTokensOnlyForMembers(t *testing.T) {
	var host edition.Host
	editiontest.Each(t, []edition.Extension{probe(&host)}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		ctx := context.Background()
		ada, bob := in.Account("ada@example.test"), in.Account("bob@example.test")
		team := in.Team(ada)
		if _, _, err := host.MintComputerToken(ctx, bob, team, "session-1", time.Hour); err == nil {
			t.Fatal("minted a computer token for someone outside the team")
		}
		if _, _, err := host.MintComputerToken(ctx, ada, team, "session-1", 2*time.Hour); err == nil {
			t.Fatal("minted a computer token longer than an hour")
		}
		token, expires, err := host.MintComputerToken(ctx, ada, team, "session-1", 10*time.Minute)
		if err != nil || time.Until(expires) > 11*time.Minute {
			t.Fatalf("mint: %v, expires %v", err, expires)
		}
		req, _ := http.NewRequest("GET", in.URL+"/api/configs", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("a minted computer token was refused: %d", res.StatusCode)
		}
		// It is not a plugin token: an edition's own Bearer check does not open it.
		if who, err := host.Bearer(ctx, token); err != nil || who != nil {
			t.Fatalf("Bearer opened a computer token: %+v %v", who, err)
		}
	})
}
func TestEditionStoresObjectsInTheServersStore(t *testing.T) {
	var host edition.Host
	dir := t.TempDir()
	editiontest.Each(t, []edition.Extension{probe(&host)}, editiontest.Options{Env: map[string]string{"ARTIFACT_LOCAL_DIR": dir}}, func(t *testing.T, in *editiontest.Instance) {
		ctx := context.Background()
		team := in.Team(in.Account("ada@example.test"))
		body := "a session's archive"
		if err := host.Objects.Put(ctx, team, "probe-notes", "note-1", strings.NewReader(body), int64(len(body))); err != nil {
			t.Fatal(err)
		}
		r, err := host.Objects.Open(ctx, team, "probe-notes", "note-1")
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(r)
		r.Close()
		if string(got) != body {
			t.Fatalf("read back %q", got)
		}
		if err := host.Objects.Delete(ctx, team, "probe-notes", "note-1"); err != nil {
			t.Fatal(err)
		}
		if _, err := host.Objects.Open(ctx, team, "probe-notes", "note-1"); !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("after delete: %v", err)
		}
		if err := host.Objects.Put(ctx, team, "plugins", "note-1", strings.NewReader(body), int64(len(body))); err == nil {
			t.Fatal("an edition wrote among the plugin archives")
		}
	})
}
