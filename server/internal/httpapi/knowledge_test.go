package httpapi_test

import (
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

// knowledgeTeam is a team with an admin and two members who joined it.
func knowledgeTeam(t *testing.T, e *env) (teamID string, admin, a, b *browser, aID, bID string) {
	t.Helper()
	admin = e.admin("admin@x.io")
	teamID = newTeam(t, admin, "Knowledge")
	a, aID = e.person("a@x.io")
	b, bID = e.person("b@x.io")
	for _, person := range []*browser{a, b} {
		_, token := invite(t, admin, teamID)
		must(t, person.post("/api/invites/redeem", map[string]string{"token": token}), 200)
	}
	return
}

func spaceIDs(t *testing.T, r response) []string {
	t.Helper()
	var out []string
	for _, sp := range must(t, r, 200)["spaces"].([]any) {
		out = append(out, sp.(map[string]any)["id"].(string))
	}
	return out
}

func TestKnowledgeIsReadByWhomItsSpaceAdmits(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		teamID, admin, a, b, aID, _ := knowledgeTeam(t, e)
		base := "/api/teams/" + teamID + "/knowledge"

		// Only the admin creates a space, and every member reads it.
		refused(t, "a member creates a space", a.post(base+"/spaces", map[string]string{"name": "Rules"}), 403, "admin_required")
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Rules"}), 201)["id"].(string)
		refused(t, "a second space of the name", admin.post(base+"/spaces", map[string]string{"name": "Rules"}), 409, "knowledge_name_taken")
		folder := must(t, admin.post(base+"/folders", map[string]string{"spaceId": space, "name": "Billing"}), 201)["id"].(string)
		doc := must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "folderId": folder, "title": "Refunds", "text": "# Refunds\n\n## Window\n\nThirty days.\n"}), 201)
		docID := doc["id"].(string)
		if doc["currentVersion"].(float64) != 1 || doc["text"] != "# Refunds\n\n## Window\n\nThirty days.\n" {
			t.Fatalf("created %v", doc)
		}
		for who, c := range map[string]*browser{"a": a, "b": b} {
			if got := spaceIDs(t, c.get(base)); len(got) != 1 {
				t.Fatalf("%s reads %v", who, got)
			}
			must(t, c.get(base+"/documents/"+docID), 200)
		}

		// Narrowed to a, b reads nothing of it: not the tree, the document,
		// nor its plugin's copy.
		must(t, admin.send("PUT", base+"/spaces/"+space+"/access", map[string]any{"reading": "members", "readers": []string{aID}, "editors": []string{}}), 200)
		if got := spaceIDs(t, b.get(base)); len(got) != 0 {
			t.Fatalf("b reads %v", got)
		}
		refused(t, "b reads the document", b.get(base+"/documents/"+docID), 404, "knowledge_not_found")
		manifest := must(t, e.pluginFor(b).get("/api/knowledge"), 200)["teams"].([]any)
		if spaces := manifest[0].(map[string]any)["spaces"].([]any); len(spaces) != 0 {
			t.Fatalf("b's copy holds %v", spaces)
		}
		ma := must(t, e.pluginFor(a).get("/api/knowledge"), 200)["teams"].([]any)
		docs := ma[0].(map[string]any)["spaces"].([]any)[0].(map[string]any)["documents"].([]any)
		if got := docs[0].(map[string]any); got["id"] != docID || got["folders"].([]any)[0] != "Billing" || got["version"].(float64) != 1 {
			t.Fatalf("a's copy %v", docs)
		}

		// A member who left the team reads and proposes nothing.
		must(t, a.send("DELETE", "/api/teams/"+teamID+"/membership", nil), 204)
		refused(t, "a left and reads", a.get(base+"/documents/"+docID), 404, "team_not_found")
		refused(t, "a left and proposes", a.post(base+"/documents/"+docID+"/proposals", map[string]any{"baseVersion": 1, "text": "x"}), 404, "team_not_found")
		if teams := must(t, e.pluginFor(a).get("/api/knowledge"), 200)["teams"].([]any); len(teams) != 0 {
			t.Fatalf("a's copy after leaving %v", teams)
		}
	})
}

func TestKnowledgeChangesOnlyThroughAnEditor(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		teamID, admin, a, b, aID, _ := knowledgeTeam(t, e)
		base := "/api/teams/" + teamID + "/knowledge"
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Runbooks"}), 201)["id"].(string)
		docID := must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "title": "Deploys", "text": "v1"}), 201)["id"].(string)
		doc := base + "/documents/" + docID

		// A reader cannot save a version; their change is a proposal.
		refused(t, "a reader saves", b.post(doc+"/versions", map[string]any{"baseVersion": 1, "text": "b's"}), 403, "knowledge_not_editor")
		refused(t, "a reader makes a document", b.post(base+"/documents", map[string]any{"spaceId": space, "title": "X", "text": "x"}), 403, "knowledge_not_editor")
		fromB := must(t, b.post(doc+"/proposals", map[string]any{"baseVersion": 1, "text": "b's", "note": "typo"}), 201)
		if fromB["source"] != "console" || fromB["baseText"] != "v1" || fromB["canDecide"] != false {
			t.Fatalf("b's proposal %v", fromB)
		}

		// An agent never saves, even an editor's: its change is a proposal too.
		must(t, admin.send("PUT", base+"/spaces/"+space+"/access", map[string]any{"reading": "team", "readers": []string{}, "editors": []string{aID}}), 200)
		pa := e.pluginFor(a)
		refused(t, "an agent saves", pa.post(doc+"/versions", map[string]any{"baseVersion": 1, "text": "agent's"}), 403, "knowledge_agent_proposes")
		fromAgent := must(t, pa.post(doc+"/proposals", map[string]any{"baseVersion": 1, "text": "agent's", "computer": "MacBook", "sessionId": "s-1"}), 201)
		if fromAgent["source"] != "agent" || fromAgent["computer"] != "MacBook" {
			t.Fatalf("agent's proposal %v", fromAgent)
		}
		refused(t, "an agent accepts", pa.post(base+"/proposals/"+fromAgent["id"].(string)+"/accept", nil), 403, "knowledge_agent_proposes")
		if got := must(t, b.get(doc), 200); got["currentVersion"].(float64) != 1 || got["text"] != "v1" {
			t.Fatalf("a proposal changed the document: %v", got)
		}

		// The editor sees both, b only their own; b cannot decide.
		if got := must(t, a.get(base+"/proposals?state=pending"), 200)["proposals"].([]any); len(got) != 2 {
			t.Fatalf("the editor's queue %v", got)
		}
		if got := must(t, b.get(base+"/proposals"), 200)["proposals"].([]any); len(got) != 1 {
			t.Fatalf("b's own %v", got)
		}
		refused(t, "b accepts", b.post(base+"/proposals/"+fromAgent["id"].(string)+"/accept", nil), 404, "knowledge_not_found")

		// Accepted, the agent's text is version 2 under a's name; b's, now on
		// a version that is no longer current, is stale and stays pending.
		accepted := must(t, a.post(base+"/proposals/"+fromAgent["id"].(string)+"/accept", nil), 200)
		if accepted["state"] != "accepted" || accepted["version"].(float64) != 2 {
			t.Fatalf("accepted %v", accepted)
		}
		got := must(t, b.get(doc), 200)
		top := got["versions"].([]any)[0].(map[string]any)
		if got["text"] != "agent's" || top["source"] != "agent" || top["computer"] != "MacBook" || top["sessionId"] != "s-1" || top["author"].(map[string]any)["id"] != aID {
			t.Fatalf("after accepting %v", got)
		}
		refused(t, "accepting a stale proposal", a.post(base+"/proposals/"+fromB["id"].(string)+"/accept", nil), 409, "knowledge_stale")
		if p := must(t, a.get(base+"/proposals/"+fromB["id"].(string)), 200); p["state"] != "pending" || p["stale"] != true {
			t.Fatalf("stale proposal %v", p)
		}
		refused(t, "accepting twice", a.post(base+"/proposals/"+fromAgent["id"].(string)+"/accept", nil), 409, "knowledge_proposal_decided")
		refused(t, "declining with no reason", a.post(base+"/proposals/"+fromB["id"].(string)+"/decline", map[string]string{}), 400, "invalid_request")
		must(t, b.post(base+"/proposals/"+fromB["id"].(string)+"/withdraw", nil), 200)

		// Restoring is a new version copying the old one.
		restored := must(t, a.post(doc+"/versions/1/restore", nil), 201)
		if restored["currentVersion"].(float64) != 3 || restored["text"] != "v1" {
			t.Fatalf("restored %v", restored)
		}
		if old := must(t, b.get(doc+"?version=2"), 200); old["text"] != "agent's" || old["version"].(float64) != 2 {
			t.Fatalf("version 2 %v", old)
		}
	})
}

func TestKnowledgeVersionsOnOneBaseMakeExactlyOne(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Knowledge")
		base := "/api/teams/" + teamID + "/knowledge"
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Notes"}), 201)["id"].(string)
		doc := base + "/documents/" + must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "title": "One", "text": "v1"}), 201)["id"].(string)

		var wg sync.WaitGroup
		statuses := make([]int, 6)
		for i := range statuses {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				statuses[i] = admin.post(doc+"/versions", map[string]any{"baseVersion": 1, "text": "racing"}).status
			}(i)
		}
		wg.Wait()
		won := 0
		for _, s := range statuses {
			switch s {
			case 201:
				won++
			case 409:
			default:
				t.Fatalf("a racing save answered %d", s)
			}
		}
		if got := must(t, admin.get(doc), 200); won != 1 || got["currentVersion"].(float64) != 2 || len(got["versions"].([]any)) != 2 {
			t.Fatalf("%d saves won; %v", won, got)
		}
		refused(t, "a stale base", admin.post(doc+"/versions", map[string]any{"baseVersion": 1, "text": "late"}), 409, "knowledge_stale")
	})
}

func TestKnowledgeGoesWithItsTeam(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		teamID, admin, _, b, _, bID := knowledgeTeam(t, e)
		base := "/api/teams/" + teamID + "/knowledge"
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Gone"}), 201)["id"].(string)
		must(t, admin.post(base+"/folders", map[string]string{"spaceId": space, "name": "F"}), 201)
		docID := must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "title": "D", "text": "v1"}), 201)["id"].(string)
		must(t, b.post(base+"/documents/"+docID+"/proposals", map[string]any{"baseVersion": 1, "text": "v2"}), 201)
		must(t, admin.send("PUT", base+"/spaces/"+space+"/access", map[string]any{"reading": "members", "readers": []string{bID}, "editors": []string{}}), 200)

		must(t, admin.send("DELETE", "/api/teams/"+teamID, map[string]string{"confirm": "Knowledge"}), 204)
		ctx := t.Context()
		c := d.Client
		left := c.KnowledgeSpace.Query().CountX(ctx) + c.KnowledgeSpaceMember.Query().CountX(ctx) + c.KnowledgeFolder.Query().CountX(ctx) +
			c.KnowledgeDocument.Query().CountX(ctx) + c.KnowledgeVersion.Query().CountX(ctx) + c.KnowledgeProposal.Query().CountX(ctx)
		if left != 0 {
			t.Fatalf("%d knowledge rows outlived their team", left)
		}
	})
}
