package httpapi_test

import (
	"context"
	"errors"
	"fmt"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"net/http"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestReviewedPresetPublicationAndUpdate(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		member, _ := e.person("member@x.io")
		outsider, _ := e.person("outsider@x.io")
		teamID := newTeam(t, admin, "Sharing")
		_, token := invite(t, admin, teamID)
		must(t, member.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		base := "/api/teams/" + teamID
		config := map[string]any{"kind": "preset", "name": "Review", "data": map[string]any{"inheritModel": true, "systemPrompt": "Review carefully"}}
		draft := must(t, member.post(base+"/submissions", map[string]any{"config": config, "baseVersion": 0, "note": "First review preset"}), 200)
		id := draft["id"].(string)
		path := base + "/submissions/" + id
		if len(jsonArray(t, admin.get(base+"/configs"))) != 1 {
			t.Fatal("draft published prematurely")
		}
		refused(t, "outsider listing", outsider.get(base+"/submissions"), 404, "team_not_found")
		pending := must(t, member.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		// The review queue is a server filter: what waits, and nothing else.
		if rows := jsonArray(t, admin.get(base+"/submissions?state=pending")); len(rows) != 1 || rows[0].(map[string]any)["id"] != id {
			t.Fatalf("pending queue: %v", rows)
		}
		if rows := jsonArray(t, admin.get(base+"/submissions?state=published")); len(rows) != 0 {
			t.Fatalf("published before approval: %v", rows)
		}
		refused(t, "unknown state", admin.get(base+"/submissions?state=lost"), 400, "invalid_request")
		refused(t, "member approving", member.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 403, "admin_required")
		refused(t, "editing pending", member.send("PUT", path, map[string]any{"config": config, "baseVersion": 0, "note": "changed", "revision": pending["revision"]}), 409, "submission_conflict")
		approved := must(t, admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 200)
		if approved["state"] != "published" {
			t.Fatalf("decision: %v", approved)
		}
		must(t, admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 200)
		if n := d.Client.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(draft["configId"].(string))).CountX(context.Background()); n != 1 {
			t.Fatalf("duplicate publication: %d", n)
		}
		// Two proposals on the same base: publishing one cannot overwrite the other.
		var updates []map[string]any
		for i := range 2 {
			config["name"] = fmt.Sprintf("Review %d", i)
			row := must(t, member.post(base+"/submissions", map[string]any{"config": config, "configId": draft["configId"], "baseVersion": 1, "note": "Update"}), 200)
			updates = append(updates, must(t, member.post(base+"/submissions/"+row["id"].(string)+"/submit", map[string]any{"revision": row["revision"]}), 200))
		}
		must(t, admin.post(base+"/submissions/"+updates[0]["id"].(string)+"/approve", map[string]any{"revision": updates[0]["revision"]}), 200)
		refused(t, "stale update", admin.post(base+"/submissions/"+updates[1]["id"].(string)+"/approve", map[string]any{"revision": updates[1]["revision"]}), http.StatusConflict, "config_conflict")
		rows := jsonArray(t, admin.get(base+"/submissions"))
		for _, v := range rows {
			r := v.(map[string]any)
			if r["id"] == updates[1]["id"] && r["state"] != "pending" {
				t.Fatal("failed approval committed a decision")
			}
		}
	})
}

func TestReviewVisibilityWithdrawalAndRejection(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		a, _ := e.person("a@x.io")
		b, _ := e.person("b@x.io")
		teamID := newTeam(t, admin, "Review")
		for _, person := range []*browser{a, b} {
			_, token := invite(t, admin, teamID)
			must(t, person.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		}
		base := "/api/teams/" + teamID + "/submissions"
		input := map[string]any{"config": map[string]any{"kind": "preset", "name": "Private draft", "data": map[string]any{"inheritModel": true}}, "baseVersion": 0, "note": ""}
		draft := must(t, a.post(base, input), 200)
		path := base + "/" + draft["id"].(string)
		if len(jsonArray(t, b.get(base))) != 0 {
			t.Fatal("another member read draft")
		}
		refused(t, "another member submitting", b.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 404, "submission_not_found")
		pending := must(t, a.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		must(t, a.post(path+"/withdraw", map[string]any{"revision": pending["revision"]}), 200)
		refused(t, "approve withdrawn", admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 409, "submission_conflict")
		draft = must(t, a.post(base, input), 200)
		path = base + "/" + draft["id"].(string)
		pending = must(t, a.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		refused(t, "reason required", admin.post(path+"/reject", map[string]any{"revision": pending["revision"]}), 400, "reason_required")
		must(t, admin.post(path+"/reject", map[string]any{"revision": pending["revision"], "reason": "Please describe the tools"}), 200)
		if len(jsonArray(t, admin.get("/api/teams/"+teamID+"/configs"))) != 1 {
			t.Fatal("rejection or withdrawal published")
		}
		// The review queue is the team's; an admin's own list is theirs alone.
		must(t, admin.post(base, map[string]any{"config": map[string]any{"kind": "preset", "name": "Admin draft", "data": map[string]any{"inheritModel": true}}, "baseVersion": 0, "note": ""}), 200)
		if all, mine := jsonArray(t, admin.get(base)), jsonArray(t, admin.get(base+"?mine=true")); len(all) != 3 || len(mine) != 1 {
			t.Fatalf("the admin's lists: %d in the team, %d of their own", len(all), len(mine))
		}
		if len(jsonArray(t, a.get(base+"?mine=true"))) != 2 {
			t.Fatal("a member's own list changed")
		}
	})
}

func TestPublicationHistoryFailureRollsBackApproval(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Atomic review")
		base := "/api/teams/" + teamID
		draft := must(t, admin.post(base+"/submissions", map[string]any{"config": map[string]any{"kind": "preset", "name": "Atomic", "data": map[string]any{"inheritModel": true}}, "baseVersion": 0, "note": ""}), 200)
		path := base + "/submissions/" + draft["id"].(string)
		pending := must(t, admin.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		fail := true
		d.Client.ConfigRevision.Use(func(next ent.Mutator) ent.Mutator {
			return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
				if fail {
					return nil, errors.New("injected history failure")
				}
				return next.Mutate(ctx, m)
			})
		})
		refused(t, "failed history", admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 500, "internal_error")
		if len(jsonArray(t, admin.get(base+"/configs"))) != 1 {
			t.Fatal("live config committed without history")
		}
		fail = false
		must(t, admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 200)
	})
}

func TestConcurrentApprovalPublishesOnce(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Concurrent review")
		base := "/api/teams/" + teamID
		draft := must(t, admin.post(base+"/submissions", map[string]any{"config": map[string]any{"kind": "preset", "name": "Concurrent", "data": map[string]any{"inheritModel": true}}, "baseVersion": 0, "note": ""}), 200)
		path := base + "/submissions/" + draft["id"].(string)
		pending := must(t, admin.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		gate := make(chan struct{})
		results := make(chan response, 2)
		for range 2 {
			go func() {
				<-gate
				results <- admin.post(path+"/approve", map[string]any{"revision": pending["revision"]})
			}()
		}
		close(gate)
		for range 2 {
			r := <-results
			if r.status != 200 && r.status != 409 {
				t.Errorf("concurrent approval returned %d", r.status)
			}
		}
		if n := d.Client.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(draft["configId"].(string))).CountX(context.Background()); n != 1 {
			t.Fatalf("published %d times", n)
		}
	})
}
