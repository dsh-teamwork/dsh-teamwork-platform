package httpapi_test

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/knowledge"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/objectstore"
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

// attach uploads one file to a document, as a browser or a plugin would.
func attach(t *testing.T, e *env, client *http.Client, header map[string]string, path, name string, content []byte) response {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, _ := w.CreateFormFile("file", name)
	part.Write(content)
	w.Close()
	h := map[string]string{"Content-Type": w.FormDataContentType()}
	for k, v := range header {
		h[k] = v
	}
	return do(t, client, "POST", e.url+path, body.String(), h)
}

func TestKnowledgeAttachmentsKeepTheirBytes(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		store := objectstore.Local{Dir: t.TempDir()}
		e := start(t, d, options{objects: store})
		teamID, admin, a, b, _, _ := knowledgeTeam(t, e)
		base := "/api/teams/" + teamID + "/knowledge"
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Diagrams"}), 201)["id"].(string)
		docID := must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "title": "Flow", "text": "![[flow.png]]\n"}), 201)["id"].(string)
		doc := base + "/documents/" + docID
		png := []byte("\x89PNG\r\n\x1a\nfake image")

		// A reader, or their agent, may attach: a file does nothing until an
		// editor's version names it.
		pa := e.pluginFor(a)
		first := attach(t, e, http.DefaultClient, map[string]string{"Authorization": "Bearer " + pa.token}, doc+"/attachments", "flow.png", png)
		if got := must(t, first, 201); got["name"] != "flow.png" || got["contentType"] != "image/png" || got["size"].(float64) != float64(len(png)) {
			t.Fatalf("attached %v", got)
		}
		browserHeader := map[string]string{"Origin": b.origin}
		must(t, attach(t, e, b.client, browserHeader, doc+"/attachments", "flow.png", png), 200)
		refused(t, "the same name, other bytes", attach(t, e, b.client, browserHeader, doc+"/attachments", "flow.png", []byte("other")), 409, "knowledge_name_taken")
		refused(t, "a type knowledge does not keep", attach(t, e, b.client, browserHeader, doc+"/attachments", "run.exe", []byte("x")), 400, "invalid_request")
		refused(t, "a name a link cannot hold", attach(t, e, b.client, browserHeader, doc+"/attachments", "a]b.png", png), 400, "invalid_request")

		// The document lists it, the copy's manifest gives its digest, and its
		// bytes come back under a sandbox.
		if got := must(t, b.get(doc), 200)["attachments"].([]any); len(got) != 1 || got[0].(map[string]any)["name"] != "flow.png" {
			t.Fatalf("listed %v", got)
		}
		manifest := must(t, pa.get("/api/knowledge"), 200)["teams"].([]any)[0].(map[string]any)["spaces"].([]any)[0].(map[string]any)["documents"].([]any)[0].(map[string]any)
		if files := manifest["attachments"].([]any); len(files) != 1 || files[0].(map[string]any)["digest"] == "" {
			t.Fatalf("manifest %v", manifest)
		}
		res, err := b.client.Get(e.url + doc + "/attachments/flow.png")
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || !bytes.Equal(got, png) || res.Header.Get("Content-Type") != "image/png" ||
			!strings.HasPrefix(res.Header.Get("Content-Security-Policy"), "sandbox") || res.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("served %d %q %v", res.StatusCode, got, res.Header)
		}

		// A PDF is shown inline without a sandbox, which Chromium's viewer
		// refuses; an SVG, which can hold script, keeps one.
		for name, sandboxed := range map[string]bool{"spec.pdf": false, "icon.svg": true} {
			must(t, attach(t, e, b.client, browserHeader, doc+"/attachments", name, []byte("<x/>")), 201)
			res, err := b.client.Get(e.url + doc + "/attachments/" + name)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if has := strings.HasPrefix(res.Header.Get("Content-Security-Policy"), "sandbox"); has != sandboxed || !strings.HasPrefix(res.Header.Get("Content-Disposition"), "inline") {
				t.Fatalf("%s served with %v", name, res.Header)
			}
		}

		// Narrowed away from b, the file is as hidden as the document.
		must(t, admin.send("PUT", base+"/spaces/"+space+"/access", map[string]any{"reading": "members", "readers": []string{}, "editors": []string{}}), 200)
		if res, _ := b.client.Get(e.url + doc + "/attachments/flow.png"); res.StatusCode != 404 {
			t.Fatalf("hidden attachment: %d", res.StatusCode)
		}

		// Deleting the document forgets the bytes no other document names.
		objects, _ := filepath.Glob(filepath.Join(store.Dir, "teams", teamID, "knowledge", "*"))
		if len(objects) != 2 { // the PNG, and the PDF and SVG holding the same bytes
			t.Fatalf("stored %v", objects)
		}
		must(t, admin.send("DELETE", doc, nil), 204)
		if objects, _ := filepath.Glob(filepath.Join(store.Dir, "teams", teamID, "knowledge", "*")); len(objects) != 0 {
			t.Fatalf("left %v", objects)
		}
	})
}

func TestKnowledgeAttachmentsStayWithinTheTeamQuota(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{objects: objectstore.Local{Dir: t.TempDir()}})
		admin := e.admin("admin@x.io")
		teamID := newTeam(t, admin, "Knowledge")
		base := "/api/teams/" + teamID + "/knowledge"
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Full"}), 201)["id"].(string)
		doc := base + "/documents/" + must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "title": "D", "text": "x"}), 201)["id"].(string)
		defer func(q int64) { knowledge.TeamAttachmentQuota = q }(knowledge.TeamAttachmentQuota)
		knowledge.TeamAttachmentQuota = 8
		h := map[string]string{"Origin": admin.origin}
		must(t, attach(t, e, admin.client, h, doc+"/attachments", "a.txt", []byte("12345")), 201)
		refused(t, "past the team's quota", attach(t, e, admin.client, h, doc+"/attachments", "b.txt", []byte("67890")), 413, "knowledge_team_full")
		// The same bytes again take no more room.
		must(t, attach(t, e, admin.client, h, doc+"/attachments", "c.txt", []byte("12345")), 201)
	})
}

func backlinkTitles(t *testing.T, r response) []string {
	t.Helper()
	out := []string{}
	for _, l := range must(t, r, 200)["backlinks"].([]any) {
		out = append(out, l.(map[string]any)["title"].(string))
	}
	return out
}

func TestKnowledgeBacklinksAreTheLinksAReaderSees(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		teamID, admin, a, b, aID, _ := knowledgeTeam(t, e)
		base := "/api/teams/" + teamID + "/knowledge"
		handbook := must(t, admin.post(base+"/spaces", map[string]string{"name": "Handbook"}), 201)["id"].(string)
		private := must(t, admin.post(base+"/spaces", map[string]string{"name": "Private"}), 201)["id"].(string)
		must(t, admin.send("PUT", base+"/spaces/"+private+"/access", map[string]any{"reading": "members", "readers": []string{aID}, "editors": []string{}}), 200)
		create := func(space, title, text string) string {
			return must(t, admin.post(base+"/documents", map[string]any{"spaceId": space, "title": title, "text": text}), 201)["id"].(string)
		}
		pricing := create(handbook, "Pricing", "# Pricing\n\n## Tiers\n")
		create(handbook, "Plans", "See [[Pricing#Tiers|the tiers]].\n")
		create(handbook, "Code", "```\n[[Pricing]]\n```\n\nAnd `[[Pricing]]` is code.\n")
		create(handbook, "Files", "[[Pricing.pdf]] is a file, [[Pricing sheet]] another document.\n")
		create(private, "Secret", "Our [[pricing]] is secret.\n")
		old := create(handbook, "Old", "Was [[Pricing]].\n")
		must(t, admin.post(base+"/documents/"+old+"/versions", map[string]any{"baseVersion": 1, "text": "Is nothing now.\n"}), 201)

		if got := backlinkTitles(t, a.get(base+"/documents/"+pricing)); strings.Join(got, ",") != "Plans,Secret" {
			t.Fatalf("a's backlinks %v", got)
		}
		// b reads no Private document, so no link from one.
		if got := backlinkTitles(t, b.get(base+"/documents/"+pricing)); strings.Join(got, ",") != "Plans" {
			t.Fatalf("b's backlinks %v", got)
		}
		// A title two documents have opens the one in the link's own space.
		create(private, "Pricing", "Private prices.\n")
		if got := backlinkTitles(t, a.get(base+"/documents/"+pricing)); strings.Join(got, ",") != "Plans" {
			t.Fatalf("a's backlinks once Private has its own Pricing %v", got)
		}
	})
}

func TestKnowledgeTemplatesAreAFolderOfTheSpace(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		teamID, admin, _, b, _, _ := knowledgeTeam(t, e)
		base := "/api/teams/" + teamID + "/knowledge"
		space := must(t, admin.post(base+"/spaces", map[string]string{"name": "Runbooks"}), 201)["id"].(string)
		other := must(t, admin.post(base+"/spaces", map[string]string{"name": "Other"}), 201)["id"].(string)
		folder := must(t, admin.post(base+"/folders", map[string]string{"spaceId": space, "name": "Templates"}), 201)["id"].(string)
		elsewhere := must(t, admin.post(base+"/folders", map[string]string{"spaceId": other, "name": "Templates"}), 201)["id"].(string)

		refused(t, "a reader names the templates folder", b.send("PATCH", base+"/spaces/"+space, map[string]any{"templatesFolderId": folder}), 403, "knowledge_not_editor")
		refused(t, "another space's folder", admin.send("PATCH", base+"/spaces/"+space, map[string]any{"templatesFolderId": elsewhere}), 404, "knowledge_not_found")
		must(t, admin.send("PATCH", base+"/spaces/"+space, map[string]any{"templatesFolderId": folder}), 204)
		templates := func() string {
			for _, sp := range must(t, b.get(base), 200)["spaces"].([]any) {
				if s := sp.(map[string]any); s["id"] == space {
					return s["templatesFolderId"].(string)
				}
			}
			return "?"
		}
		if got := templates(); got != folder {
			t.Fatalf("templates folder %q", got)
		}
		// Renaming keeps it, and deleting the folder clears it.
		must(t, admin.send("PATCH", base+"/spaces/"+space, map[string]any{"name": "Ops"}), 204)
		if got := templates(); got != folder {
			t.Fatalf("templates folder after a rename %q", got)
		}
		must(t, admin.send("DELETE", base+"/folders/"+folder, nil), 204)
		if got := templates(); got != "" {
			t.Fatalf("templates folder after its deletion %q", got)
		}
	})
}
