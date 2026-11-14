package auth_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/identity"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// toStub sends Google's hosts to the stub, keeping the path.
type toStub struct{ stub *url.URL }

func (s toStub) RoundTrip(r *http.Request) (*http.Response, error) {
	switch r.URL.Host {
	case "oauth2.googleapis.com", "accounts.google.com", "www.googleapis.com":
		r = r.Clone(r.Context())
		r.URL.Scheme, r.URL.Host, r.Host = s.stub.Scheme, s.stub.Host, s.stub.Host
	}
	return http.DefaultTransport.RoundTrip(r)
}

// stubGoogle answers the token and userinfo endpoints with userinfo.
func stubGoogle(t *testing.T, userinfo map[string]any) *auth.Google {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/token":
			json.NewEncoder(w).Encode(map[string]any{"access_token": "stub-access", "token_type": "Bearer", "expires_in": 3600})
		case r.Method == http.MethodGet && r.URL.Path == "/oauth2/v2/userinfo":
			if r.URL.Query().Get("access_token") != "stub-access" {
				http.Error(w, "{}", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(userinfo)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return auth.NewGoogle("client-id", "client-secret", "https://teamwork.example", &http.Client{Transport: toStub{u}})
}

func googleUser(id, email string, verified bool) map[string]any {
	return map[string]any{"id": id, "email": email, "verified_email": verified, "name": "Ada", "picture": "https://example.test/a.png"}
}

func TestGoogleAuthURL(t *testing.T) {
	g := stubGoogle(t, nil)
	raw, err := g.AuthURL("the-state")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("state") != "the-state" || q.Get("redirect_uri") != "https://teamwork.example"+auth.GoogleCallbackPath {
		t.Fatalf("auth URL %s", raw)
	}
}

func TestGoogleProof(t *testing.T) {
	ctx := context.Background()
	code := url.Values{"code": {"stub-code"}, "state": {"s"}}

	p, err := stubGoogle(t, googleUser("g-1", "Ada@Example.test", true)).Proof(ctx, code)
	if err != nil {
		t.Fatal(err)
	}
	if p.Provider != "google" || p.Subject != "g-1" || p.Email == nil || *p.Email != "ada@example.test" {
		t.Fatalf("proof %+v", p)
	}

	_, err = stubGoogle(t, googleUser("g-2", "eve@example.test", false)).Proof(ctx, code)
	if !auth.IsUnverified(err) {
		t.Fatalf("an unverified email: %v", err)
	}
}

func googleProof(id, email string) auth.Proof {
	return auth.Proof{Provider: "google", Subject: id, Email: &email}
}

// Google and an emailed code for one verified address are one account.
func TestGoogleJoinsTheEmailAccount(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		existing, err := ensureUser(ctx, d.Client, "ada@example.test")
		if err != nil {
			t.Fatal(err)
		}
		u, created, err := auth.Account(ctx, d.Client, googleProof("g-1", "ada@example.test"))
		if err != nil || created || u.ID != existing.ID {
			t.Fatalf("joined %v created=%v err=%v, want %s", u, created, err, existing.ID)
		}

		u, created, err = auth.Account(ctx, d.Client, googleProof("g-2", "new@example.test"))
		if err != nil || !created {
			t.Fatalf("new address: created=%v err=%v", created, err)
		}
		n, err := d.Client.Identity.Query().Where(identity.Provider("google"), identity.Subject("g-2"), identity.UserID(u.ID)).Count(ctx)
		if err != nil || n != 1 {
			t.Fatalf("google identity rows: %d %v", n, err)
		}
	})
}

func TestConcurrentFirstGoogleSignIn(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		const racers = 8
		type result struct {
			id      string
			created bool
			err     error
		}
		results := make([]result, racers)
		var wg sync.WaitGroup
		for i := range racers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				u, created, err := auth.Account(ctx, d.Client, googleProof("g-race", "race@example.test"))
				results[i] = result{created: created, err: err}
				if u != nil {
					results[i].id = u.ID
				}
			}()
		}
		wg.Wait()
		createdCount, id := 0, ""
		for i, r := range results {
			if r.err != nil {
				t.Errorf("racer %d: %v", i, r.err)
				continue
			}
			if r.created {
				createdCount++
			}
			if id == "" {
				id = r.id
			}
			if r.id != id {
				t.Errorf("racer %d signed in to %s, another to %s", i, r.id, id)
			}
		}
		users, err := d.Client.User.Query().Where(user.Email("race@example.test")).Count(ctx)
		if err != nil || users != 1 || createdCount != 1 {
			t.Fatalf("users %d (err %v), created=true %d times; want 1 and 1", users, err, createdCount)
		}
	})
}

// A long Google display name or picture address does not stop its owner
// signing in: the name is cut to what the profile holds, the picture dropped.
func TestLongGoogleProfileStillSignsIn(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		email := "long@example.test"
		name := strings.Repeat("名", 120)
		image := "https://example.test/" + strings.Repeat("p", 3000)
		u, created, err := auth.Account(context.Background(), d.Client, auth.Proof{Provider: "google", Subject: "g-long", Email: &email, Name: &name, Image: &image})
		if err != nil || !created {
			t.Fatalf("created %v: %v", created, err)
		}
		if u.Name == nil || len([]rune(*u.Name)) != 80 || u.Image != nil {
			t.Fatalf("name %v, image %v", u.Name, u.Image)
		}
	})
}
