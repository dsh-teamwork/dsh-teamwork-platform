package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestLegacyResourceSubmissionsAreReadOnly(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		author, authorID := e.person("author@x.io")
		reader, _ := e.person("reader@x.io")
		teamID := newTeam(t, admin, "Legacy history")
		for _, member := range []*browser{author, reader} {
			_, token := invite(t, admin, teamID)
			must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		}
		row := d.Client.ResourceSubmission.Create().SetTeamID(teamID).SetAuthorID(authorID).SetConfigID("old-config").
			SetProposal(json.RawMessage(`{"kind":"preset","name":"Legacy","data":{"inheritModel":true}}`)).SetState("pending").SaveX(context.Background())
		base := "/api/teams/" + teamID
		history := base + "/submissions/" + row.ID
		must(t, author.get(history), 200)
		must(t, admin.get(history), 200)
		refused(t, "another member reads a private proposal", reader.get(history), 404, "submission_not_found")
		for _, request := range []response{author.post(base+"/submissions", nil), admin.post(history+"/approve", nil)} {
			if request.status != 404 && request.status != 405 {
				t.Fatalf("approval route remains active: %d", request.status)
			}
		}
		if configs := jsonArray(t, reader.get(base+"/configs")); len(configs) != 1 {
			t.Fatalf("legacy pending asset became visible: %v", configs)
		}
	})
}

func TestPublicationHistoryFailureRollsBackUpload(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Atomic upload")
		base := "/api/teams/" + teamID
		config := map[string]any{"kind": "preset", "name": "Atomic", "memberAsset": true, "data": map[string]any{"inheritModel": true}}
		fail := true
		d.Client.ConfigRevision.Use(func(next ent.Mutator) ent.Mutator {
			return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
				if fail {
					return nil, errors.New("injected history failure")
				}
				return next.Mutate(ctx, m)
			})
		})
		refused(t, "failed history", admin.post(base+"/configs", config), 500, "internal_error")
		if len(jsonArray(t, admin.get(base+"/configs"))) != 1 {
			t.Fatal("live config committed without history")
		}
		fail = false
		must(t, admin.post(base+"/configs", config), 201)
	})
}
