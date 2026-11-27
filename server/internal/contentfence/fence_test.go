package contentfence_test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/contentfence"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func TestCommitFenceRejectsStaleGeneration(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		teams := &team.Service{DB: d.Client}
		created, err := teams.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "owner", OwnerName: "Owner", Name: "Demo", Locale: "en"})
		if err != nil {
			t.Fatal(err)
		}
		fence := contentfence.New(d.SQL, d.Dialect())
		admitted, err := fence.Admit(ctx, created.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err := d.Client.Team.UpdateOneID(created.ID).AddContentGeneration(1).Exec(ctx); err != nil {
			t.Fatal(err)
		}
		tx, err := d.Client.Tx(admitted)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if err := tx.TeamProvider.Create().SetTeamID(created.ID).SetName("late").SetBaseURL("https://example.test").SetKeyCipher("sealed").Exec(admitted); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); errorCode(err) != "team_resetting" {
			t.Fatalf("stale commit: %v", err)
		}
		if n, _ := d.Client.TeamProvider.Query().Count(ctx); n != 0 {
			t.Fatalf("stale provider committed: %d", n)
		}

		fresh, err := fence.Admit(ctx, created.ID)
		if err != nil {
			t.Fatal(err)
		}
		tx2, err := d.Client.Tx(fresh)
		if err != nil {
			t.Fatal(err)
		}
		if err := tx2.TeamProvider.Create().SetTeamID(created.ID).SetName("fresh").SetBaseURL("https://example.test").SetKeyCipher("sealed").Exec(fresh); err != nil {
			t.Fatal(err)
		}
		if err := tx2.Commit(); err != nil {
			t.Fatal(err)
		}
		if n, _ := d.Client.TeamProvider.Query().Count(ctx); n != 1 {
			t.Fatalf("fresh provider did not commit: %d", n)
		}
	})
}

func TestAdmissionGuardRunsBeforeGenerationRead(t *testing.T) {
	fence := contentfence.New(nil, "postgres")
	fence.Guard = func(context.Context, string) error { return wire.E(http.StatusConflict, "team_resetting") }
	if _, err := fence.Admit(context.Background(), "demo"); errorCode(err) != "team_resetting" {
		t.Fatalf("guard: %v", err)
	}
}

func errorCode(err error) string {
	var coded interface{ ErrorCode() string }
	if errors.As(err, &coded) {
		return coded.ErrorCode()
	}
	return ""
}
