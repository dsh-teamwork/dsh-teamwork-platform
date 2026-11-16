package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifactstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// Fixture writes model the previous binary; production exposes no legacy writer.
func legacyArtifact(t *testing.T, store artifactstore.Store, id string, data []byte) {
	t.Helper()
	switch store := store.(type) {
	case artifactstore.Local:
		if err := os.WriteFile(filepath.Join(store.Dir, id+".tgz"), data, 0600); err != nil {
			t.Fatal(err)
		}
	case *artifactstore.S3:
		_, err := store.Client.PutObject(t.Context(), &s3.PutObjectInput{Bucket: &store.Bucket, Key: aws.String(id + ".tgz"), Body: bytes.NewReader(data), ContentLength: aws.Int64(int64(len(data)))})
		if err != nil {
			t.Fatal(err)
		}
	default:
		t.Fatal("unknown fixture provider")
	}
}

func assertArtifactBytes(t *testing.T, body io.ReadCloser, err error, want []byte) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(body)
	body.Close()
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("wrong artifact bytes: %v", err)
	}
}

func TestTeamArtifactPathsMigrateWithoutDeletingSources(t *testing.T) {
	eachArtifactStore(t, func(t *testing.T, store artifactstore.Store) {
		testdb.Each(t, func(t *testing.T, d *testdb.DB) {
			e := start(t, d, options{artifacts: store})
			a := e.admin("admin@x.io")
			teamID := newTeam(t, a, "Migration")
			other := newTeam(t, a, "Unrelated")
			archive := pluginArchive(t, "")
			base := "/api/teams/" + teamID + "/artifacts"
			upload := must(t, a.post(base, string(archive)), 200)
			id := upload["id"].(string)
			// Check the actual key, independently of the provider's key builder.
			switch s := store.(type) {
			case artifactstore.Local:
				b, err := os.ReadFile(filepath.Join(s.Dir, "teams", teamID, "plugins", id+".tgz"))
				if err != nil || !bytes.Equal(b, archive) {
					t.Fatal("wrong local path", err)
				}
			case *artifactstore.S3:
				r, err := s.Client.GetObject(t.Context(), &s3.GetObjectInput{Bucket: &s.Bucket, Key: aws.String("teams/" + teamID + "/plugins/" + id + ".tgz")})
				if err != nil {
					t.Fatal(err)
				}
				assertArtifactBytes(t, r.Body, nil, archive)
			}
			legacyArtifact(t, store, id, archive)
			if err := store.Delete(t.Context(), teamID, id); err != nil {
				t.Fatal(err)
			}
			refused(t, "cross-team legacy access", a.get("/api/teams/"+other+"/artifacts/"+id+"/download"), 404, "artifact_not_found")
			if r, err := store.Open(t.Context(), teamID, id); !errors.Is(err, fs.ErrNotExist) {
				if r != nil {
					r.Close()
				}
				t.Fatal("unauthorized request migrated an object", err)
			}
			svc := &team.Service{DB: d.Client, Artifacts: store}
			for range 2 {
				n, err := svc.MigrateArtifactPaths(t.Context())
				if err != nil || n != 1 {
					t.Fatalf("migration count=%d: %v", n, err)
				}
			}
			body, err := store.OpenLegacy(t.Context(), id)
			assertArtifactBytes(t, body, err, archive)
			body, err = store.Open(t.Context(), teamID, id)
			assertArtifactBytes(t, body, err, archive)
			// Model an old writer after the startup scan. The authorized read must
			// migrate it too; it must not wait until the next restart.
			if err := store.Delete(t.Context(), teamID, id); err != nil {
				t.Fatal(err)
			}
			r := a.get(base + "/" + id + "/download")
			if r.status != 200 || !bytes.Equal(r.body, archive) {
				t.Fatal("late legacy read failed", r.status)
			}
			body, err = store.Open(t.Context(), teamID, id)
			assertArtifactBytes(t, body, err, archive)
			// Corrupt existing destinations are never replaced from an older copy.
			if err := store.Put(t.Context(), teamID, id, bytes.NewReader([]byte("bad")), 3); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.MigrateArtifactPaths(t.Context()); err == nil {
				t.Fatal("accepted corrupt destination")
			}
			body, err = store.Open(t.Context(), teamID, id)
			assertArtifactBytes(t, body, err, []byte("bad"))
			if err := store.Delete(t.Context(), teamID, id); err != nil {
				t.Fatal(err)
			}
			legacyArtifact(t, store, id, []byte("bad source"))
			if _, err := svc.MigrateArtifactPaths(t.Context()); err == nil {
				t.Fatal("accepted corrupt source")
			}
			if body, err := store.Open(t.Context(), teamID, id); !errors.Is(err, fs.ErrNotExist) {
				if body != nil {
					body.Close()
				}
				t.Fatal("published corrupt migration", err)
			}
		})
	})
}

type migrationFailure struct {
	artifactstore.Store
	readErr      error
	corruptWrite bool
	legacyReads  int
}

func (s *migrationFailure) Open(ctx context.Context, teamID, id string) (io.ReadCloser, error) {
	if s.readErr != nil {
		return nil, s.readErr
	}
	return s.Store.Open(ctx, teamID, id)
}
func (s *migrationFailure) OpenLegacy(ctx context.Context, id string) (io.ReadCloser, error) {
	s.legacyReads++
	return s.Store.OpenLegacy(ctx, id)
}
func (s *migrationFailure) Put(ctx context.Context, teamID, id string, body io.ReadSeeker, size int64) error {
	if s.corruptWrite {
		return s.Store.Put(ctx, teamID, id, bytes.NewReader([]byte("bad")), 3)
	}
	return errors.New("write interrupted")
}

func TestArtifactPathMigrationFailsClosedAndCanResume(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		store := artifactstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{artifacts: store})
		a := e.admin("admin@x.io")
		teamID := newTeam(t, a, "Failures")
		archive := pluginArchive(t, "")
		upload := must(t, a.post("/api/teams/"+teamID+"/artifacts", string(archive)), 200)
		id := upload["id"].(string)
		if err := store.Delete(t.Context(), teamID, id); err != nil {
			t.Fatal(err)
		}
		legacyArtifact(t, store, id, archive)
		fault := &migrationFailure{Store: store, readErr: fs.ErrPermission}
		svc := &team.Service{DB: d.Client, Artifacts: fault}
		if _, err := svc.MigrateArtifactPaths(t.Context()); !errors.Is(err, fs.ErrPermission) || fault.legacyReads != 0 {
			t.Fatal("access failure triggered fallback", err)
		}
		fault.readErr = nil
		if _, err := svc.MigrateArtifactPaths(t.Context()); err == nil {
			t.Fatal("accepted failed write")
		}
		fault.corruptWrite = true
		if _, err := svc.MigrateArtifactPaths(t.Context()); err == nil {
			t.Fatal("did not verify destination")
		}
		body, err := store.OpenLegacy(t.Context(), id)
		assertArtifactBytes(t, body, err, archive)
		if err := store.Delete(t.Context(), teamID, id); err != nil {
			t.Fatal(err)
		}
		svc.Artifacts = store
		if n, err := svc.MigrateArtifactPaths(t.Context()); err != nil || n != 1 {
			t.Fatal("retry failed", n, err)
		}
	})
}

func TestProviderMigrationReadsFlatLocalSources(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		local := artifactstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{artifacts: local})
		a := e.admin("admin@x.io")
		teamID := newTeam(t, a, "Flat source")
		archive := pluginArchive(t, "")
		upload := must(t, a.post("/api/teams/"+teamID+"/artifacts", string(archive)), 200)
		id := upload["id"].(string)
		legacyArtifact(t, local, id, archive)
		if err := local.Delete(t.Context(), teamID, id); err != nil {
			t.Fatal(err)
		}
		remote := s3Artifacts(t, false)
		svc := &team.Service{DB: d.Client, Artifacts: remote}
		for range 2 {
			if n, err := svc.MigrateArtifacts(t.Context(), local.Dir); err != nil || n != 1 {
				t.Fatal("flat provider copy", n, err)
			}
		}
		body, err := local.OpenLegacy(t.Context(), id)
		assertArtifactBytes(t, body, err, archive)
		body, err = remote.Open(t.Context(), teamID, id)
		assertArtifactBytes(t, body, err, archive)
		if body, err := local.Open(t.Context(), teamID, id); !errors.Is(err, fs.ErrNotExist) {
			if body != nil {
				body.Close()
			}
			t.Fatal("source was changed", err)
		}
	})
}
