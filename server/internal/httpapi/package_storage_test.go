package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/objectstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// Exercise the SDK's real HTTP serialization, signing, and error handling.
// This fixture is an S3 protocol peer, not a second Store implementation.
func s3Packages(t *testing.T, rejectWrites bool) *objectstore.S3 {
	t.Helper()
	var mu sync.Mutex
	objects := map[string][]byte{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") || !strings.HasPrefix(r.URL.Path, "/private/") {
			http.Error(w, "missing signature or bucket", 403)
			return
		}
		switch r.Method {
		case "PUT":
			if rejectWrites {
				http.Error(w, "unavailable", 403)
				return
			}
			b, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read failed", 500)
				return
			}
			objects[r.URL.Path] = b
		case "GET":
			b, ok := objects[r.URL.Path]
			if !ok {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(404)
				io.WriteString(w, `<Error><Code>NoSuchKey</Code></Error>`)
				return
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(b)))
			w.Write(b)
		case "DELETE":
			delete(objects, r.URL.Path)
			w.WriteHeader(204)
		default:
			http.Error(w, "unsupported", 405)
		}
	}))
	t.Cleanup(server.Close)
	return &objectstore.S3{Bucket: "private", Client: s3.New(s3.Options{
		Region: "auto", BaseEndpoint: &server.URL, UsePathStyle: true,
		Credentials: credentials.NewStaticCredentialsProvider("test", "test-secret", ""),
		HTTPClient:  server.Client(), RetryMaxAttempts: 1,
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})}
}

func eachPackageStore(t *testing.T, run func(*testing.T, objectstore.Store)) {
	t.Helper()
	t.Run("local", func(t *testing.T) { run(t, objectstore.Local{Dir: t.TempDir()}) })
	t.Run("s3", func(t *testing.T) { run(t, s3Packages(t, false)) })
}

func TestS3UploadFailureDoesNotCreateMetadata(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{objects: s3Packages(t, true)})
		a := e.admin("admin@x.io")
		teamID := newTeam(t, a, "Storage failure")
		r := a.post("/api/teams/"+teamID+"/packages", string(pluginArchive(t, "")))
		if r.status != 500 {
			t.Fatalf("status: %d", r.status)
		}
		n, err := d.Client.PluginPackage.Query().Count(context.Background())
		if err != nil || n != 0 {
			t.Fatalf("metadata survived failed upload: %d, %v", n, err)
		}
	})
}

func TestS3StartupProbe(t *testing.T) {
	if err := s3Packages(t, false).Check(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := s3Packages(t, true).Check(t.Context()); err == nil {
		t.Fatal("storage with denied writes passed readiness")
	}
}

func TestAmbiguousMetadataWriteRetainsStoredBytes(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		store := s3Packages(t, false)
		e := start(t, d, options{objects: store})
		a := e.admin("admin@x.io")
		teamID := newTeam(t, a, "Ambiguous commit")
		// Simulate losing the acknowledgement after the database committed.
		d.Client.PluginPackage.Use(func(next ent.Mutator) ent.Mutator {
			return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
				v, err := next.Mutate(ctx, m)
				if err != nil {
					return v, err
				}
				return v, errors.New("commit acknowledgement lost")
			})
		})
		archive := pluginArchive(t, "")
		base := "/api/teams/" + teamID + "/packages"
		if r := a.post(base, string(archive)); r.status != 500 {
			t.Fatalf("status %d", r.status)
		}
		row, err := d.Client.PluginPackage.Query().Only(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		r := a.get(base + "/" + row.ID + "/download")
		if r.status != 200 || !bytes.Equal(r.body, archive) {
			t.Fatal("deleted bytes after ambiguous commit")
		}
	})
}

func TestPackageStorageSurvivesServerReplacement(t *testing.T) {
	eachPackageStore(t, func(t *testing.T, store objectstore.Store) {
		testdb.Each(t, func(t *testing.T, d *testdb.DB) {
			e := start(t, d, options{objects: store})
			a := e.admin("admin@x.io")
			teamID := newTeam(t, a, "Persistent")
			base := "/api/teams/" + teamID + "/packages"
			archive := pluginArchive(t, "")
			upload := must(t, a.post(base, string(archive)), 200)
			// A new API process has a fresh temporary data directory and client,
			// while its durable database and object store remain the same.
			if local, ok := store.(objectstore.Local); ok {
				store = objectstore.Local{Dir: local.Dir}
			}
			if remote, ok := store.(*objectstore.S3); ok {
				store = &objectstore.S3{Client: s3.New(remote.Client.Options()), Bucket: remote.Bucket}
			}
			replacement := start(t, d, options{objects: store})
			// Sign in against the replacement process and read the previous upload.
			client := replacement.browser()
			must(t, client.post("/api/auth/password/sign-in", map[string]string{"email": "admin@x.io", "password": "correct horse battery"}), 200)
			r := client.get(base + "/" + upload["id"].(string) + "/download")
			if r.status != 200 || !bytes.Equal(r.body, archive) {
				t.Fatalf("replacement download: %d", r.status)
			}
		})
	})
}

func TestPackageMigrationVerifiesEveryDatabaseRow(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		local := objectstore.Local{Dir: t.TempDir()}
		remote := s3Packages(t, false)
		e := start(t, d, options{objects: local})
		a := e.admin("admin@x.io")
		teamID := newTeam(t, a, "Migration")
		archive := pluginArchive(t, "")
		upload := must(t, a.post("/api/teams/"+teamID+"/packages", string(archive)), 200)
		id := upload["id"].(string)
		svc := &team.Service{DB: d.Client, Objects: remote}
		for range 2 {
			n, err := svc.MigratePackages(t.Context(), local.Dir)
			if err != nil || n != 1 {
				t.Fatalf("migration count=%d: %v", n, err)
			}
		}
		body, err := remote.Open(t.Context(), teamID, id)
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(body)
		body.Close()
		if err != nil || !bytes.Equal(b, archive) {
			t.Fatal("migration changed bytes", err)
		}
		// Missing or corrupt source must abort, leaving the good destination intact.
		if err := local.Put(t.Context(), teamID, id, strings.NewReader("corrupt"), 7); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.MigratePackages(t.Context(), local.Dir); err == nil {
			t.Fatal("accepted corrupt source")
		}
		if err := local.Delete(t.Context(), teamID, id); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.MigratePackages(t.Context(), local.Dir); err == nil {
			t.Fatal("accepted missing source")
		}
		body, err = remote.Open(t.Context(), teamID, id)
		if err != nil {
			t.Fatal(err)
		}
		b, err = io.ReadAll(body)
		body.Close()
		if err != nil || !bytes.Equal(b, archive) {
			t.Fatal("failed migration damaged destination", err)
		}
	})
}

// An edition's objects (edition.Host.Objects) live beside the plugin archives
// under keys of their own, and can never name one.
func TestEditionObjectsKeepToTheirOwnKind(t *testing.T) {
	eachPackageStore(t, func(t *testing.T, store objectstore.Store) {
		ctx := t.Context()
		archive := []byte("plugin archive")
		if err := store.Put(ctx, "team1", "same-id", bytes.NewReader(archive), int64(len(archive))); err != nil {
			t.Fatal(err)
		}
		object := []byte("an edition's object")
		if err := store.PutObject(ctx, "team1", "cloud-sessions", "same-id", bytes.NewReader(object), int64(len(object))); err != nil {
			t.Fatal(err)
		}
		read := func(r io.ReadCloser, err error) []byte {
			t.Helper()
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			b, _ := io.ReadAll(r)
			return b
		}
		if got := read(store.OpenObject(ctx, "team1", "cloud-sessions", "same-id")); !bytes.Equal(got, object) {
			t.Fatalf("object: %q", got)
		}
		if got := read(store.Open(ctx, "team1", "same-id")); !bytes.Equal(got, archive) {
			t.Fatalf("the plugin archive changed: %q", got)
		}
		if _, err := store.OpenObject(ctx, "team2", "cloud-sessions", "same-id"); !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("another team's object: %v", err)
		}
		for _, k := range [][3]string{{"team1", "plugins", "same-id"}, {"team1", "Cloud", "x"}, {"team1", "cloud-sessions", "../x"}, {"../t", "cloud-sessions", "x"}} {
			if err := store.PutObject(ctx, k[0], k[1], k[2], bytes.NewReader(object), int64(len(object))); err == nil {
				t.Fatalf("stored under %v", k)
			}
		}
		if err := store.DeleteObject(ctx, "team1", "cloud-sessions", "same-id"); err != nil {
			t.Fatal(err)
		}
		if err := store.DeleteObject(ctx, "team1", "cloud-sessions", "same-id"); err != nil {
			t.Fatalf("deleting again: %v", err)
		}
		if _, err := store.OpenObject(ctx, "team1", "cloud-sessions", "same-id"); !errors.Is(err, fs.ErrNotExist) {
			t.Fatalf("after delete: %v", err)
		}
		if got := read(store.Open(ctx, "team1", "same-id")); !bytes.Equal(got, archive) {
			t.Fatal("deleting the object touched the plugin archive")
		}
	})
}
