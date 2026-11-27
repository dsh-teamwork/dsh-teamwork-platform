package team

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/artifact"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/assetselection"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgecomment"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeproposal"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/objectstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func TestSystemTeamAndJoinMember(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		var changes []edition.TeamChange
		s := &Service{DB: d.Client, Changed: func(_ context.Context, _ *ent.Client, change edition.TeamChange) error {
			changes = append(changes, change)
			return nil
		}}
		created, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "demo-owner", OwnerName: "DSH Teamwork", Name: "Whale Studio", Locale: "en"})
		if err != nil {
			t.Fatal(err)
		}
		again, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "demo-owner", OwnerName: "DSH Teamwork", Name: "Whale Studio", Locale: "en"})
		if err != nil || again.ID != created.ID {
			t.Fatalf("idempotent create: %#v, %v", again, err)
		}
		if n, _ := d.Client.Team.Query().Count(ctx); n != 1 {
			t.Fatalf("teams after repeated create: %d", n)
		}
		owner, err := d.Client.User.Get(ctx, created.OwnerID)
		if err != nil || owner.Email != nil {
			t.Fatalf("system owner: %#v, %v", owner, err)
		}
		if len(changes) != 1 || changes[0].Kind != edition.TeamCreated || !changes[0].System {
			t.Fatalf("creation events: %#v", changes)
		}
		assistant, err := d.Client.TeamConfig.Query().Where(teamconfig.TeamID(created.ID), teamconfig.KindEQ(teamconfig.KindPreset)).Count(ctx)
		if err != nil || assistant != 1 {
			t.Fatalf("built-in assistant: %d, %v", assistant, err)
		}

		user := d.Client.User.Create().SetEmail("member@example.test").SaveX(ctx)
		joined, err := s.JoinMember(ctx, user.ID, created.ID)
		if err != nil || !joined {
			t.Fatalf("join: %v, %v", joined, err)
		}
		joined, err = s.JoinMember(ctx, user.ID, created.ID)
		if err != nil || joined {
			t.Fatalf("repeated join: %v, %v", joined, err)
		}
		m, err := d.Client.Membership.Query().Where(membership.TeamID(created.ID), membership.UserID(user.ID)).Only(ctx)
		if err != nil || m.Role != membership.RoleMember {
			t.Fatalf("membership: %#v, %v", m, err)
		}
		if _, err := s.RequireMembership(ctx, user.ID, created.ID, true); err == nil {
			t.Fatal("ordinary member passed an administrator check")
		}
		if len(changes) != 2 || changes[1].Kind != edition.MemberJoined || !changes[1].System {
			t.Fatalf("join events: %#v", changes)
		}

		if _, err := s.CreateTeam(ctx, user.ID, wire.CreateTeam{Name: "Own team"}, "en"); err != nil {
			t.Fatal(err)
		}
		if len(changes) != 3 || changes[2].System {
			t.Fatalf("personal creation was marked system: %#v", changes)
		}
		personal := d.Client.User.Create().SetID("external-user").SaveX(ctx)
		d.Client.Identity.Create().SetProvider("feishu").SetSubject("subject").SetUserID(personal.ID).ExecX(ctx)
		if _, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "not-system", OwnerID: personal.ID, OwnerName: "Person", Name: "Bad", Locale: "en"}); err == nil {
			t.Fatal("an account with a sign-in door became a system owner")
		}
		if _, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "../bad", OwnerID: "system-user", OwnerName: "System", Name: "Bad", Locale: "en"}); err == nil {
			t.Fatal("an unsafe team id was accepted")
		}
	})
}

func TestResetTeamContentPreservesScopeAndMembership(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		store := objectstore.Local{Dir: t.TempDir()}
		s := &Service{DB: d.Client, Objects: store}
		demo, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "demo-owner", OwnerName: "DSH Teamwork", Name: "Whale Studio", Locale: "en"})
		if err != nil {
			t.Fatal(err)
		}
		user := d.Client.User.Create().SetEmail("member@example.test").SaveX(ctx)
		if _, err := s.JoinMember(ctx, user.ID, demo.ID); err != nil {
			t.Fatal(err)
		}
		other, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "other", OwnerID: "other-owner", OwnerName: "Other", Name: "Other", Locale: "en"})
		if err != nil {
			t.Fatal(err)
		}
		seed := testSeed()
		if _, err := s.ResetTeamContent(ctx, demo.ID, demo.OwnerID, seed); err != nil {
			t.Fatal(err)
		}

		model := d.Client.TeamConfig.Create().SetTeamID(demo.ID).SetKind(teamconfig.KindModel).SetName("Hosted").
			SetData(json.RawMessage(`{"provider":"hosted","model":"deepseek-flash"}`)).SaveX(ctx)
		if _, err := s.CreateConfig(ctx, user.ID, demo.ID, wire.ConfigInput{Kind: "preset", Name: "Member preset", Data: json.RawMessage(`{"inheritModel":true}`)}); err != nil {
			t.Fatal(err)
		}
		d.Client.AssetSelection.Create().SetTeamID(demo.ID).SetUserID(user.ID).SetConfigID(seed.Configs[0].ID).SaveX(ctx)
		d.Client.ResourceSubmission.Create().SetTeamID(demo.ID).SetAuthorID(user.ID).SetConfigID(seed.Configs[0].ID).
			SetProposal(json.RawMessage(`{}`)).SaveX(ctx)
		d.Client.ResourceSubmission.Create().SetTeamID(other.ID).SetAuthorID(other.OwnerID).SetConfigID(seed.Configs[0].ID).
			SetProposal(json.RawMessage(`{}`)).SaveX(ctx)
		d.Client.PluginPackage.Create().SetTeamID(demo.ID).SetAuthorID(user.ID).SetPackage("member-package").SetVersion("1.0.0").
			SetSha256("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").SetSize(1).SetFiles([]string{"index.js"}).SaveX(ctx)
		d.Client.PluginPackage.Create().SetTeamID(other.ID).SetAuthorID(other.OwnerID).SetPackage("other-package").SetVersion("1.0.0").
			SetSha256("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").SetSize(1).SetFiles([]string{"index.js"}).SaveX(ctx)

		userObject := putTestObject(t, ctx, store, demo.ID, "pages", []byte("member artifact"))
		makeTestArtifact(t, ctx, d.Client, demo.ID, user.ID, "member-artifact", userObject)
		otherObject := putTestObject(t, ctx, store, other.ID, "pages", []byte("other artifact"))
		makeTestArtifact(t, ctx, d.Client, other.ID, other.OwnerID, "other-artifact", otherObject)
		attachmentObject := putTestObject(t, ctx, store, demo.ID, "knowledge", []byte("attachment"))
		documentID := seed.Spaces[0].Documents[0].ID
		d.Client.KnowledgeAttachment.Create().SetTeamID(demo.ID).SetDocumentID(documentID).SetName("notes.txt").
			SetContentType("text/plain").SetSize(10).SetDigest(attachmentObject).SetCreatedBy(user.ID).SaveX(ctx)
		d.Client.KnowledgeComment.Create().SetTeamID(demo.ID).SetDocumentID(documentID).SetAuthorID(user.ID).SetVersion(1).SetBody("comment").SaveX(ctx)
		d.Client.KnowledgeProposal.Create().SetTeamID(demo.ID).SetDocumentID(documentID).SetBaseVersion(1).
			SetAuthorID(user.ID).SetSource(knowledgeproposal.SourceConsole).SetText("proposal").SaveX(ctx)

		if _, err := s.ResetTeamContent(ctx, demo.ID, demo.OwnerID, seed); err != nil {
			t.Fatal(err)
		}
		if n, _ := d.Client.Membership.Query().Where(membership.TeamID(demo.ID)).Count(ctx); n != 2 {
			t.Fatalf("demo memberships changed: %d", n)
		}
		if _, err := d.Client.TeamConfig.Get(ctx, model.ID); err != nil {
			t.Fatalf("model was reset: %v", err)
		}
		if n, _ := d.Client.TeamConfig.Query().Where(teamconfig.TeamID(demo.ID), teamconfig.KindEQ(teamconfig.KindPreset)).Count(ctx); n != 2 {
			t.Fatalf("expected assistant and seed preset, got %d", n)
		}
		if n, _ := d.Client.Artifact.Query().Where(artifact.TeamID(demo.ID)).Count(ctx); n != 1 {
			t.Fatalf("demo artifacts: %d", n)
		}
		if n, _ := d.Client.KnowledgeComment.Query().Where(knowledgecomment.TeamID(demo.ID)).Count(ctx); n != 0 {
			t.Fatalf("comments survived: %d", n)
		}
		if n, _ := d.Client.KnowledgeProposal.Query().Where(knowledgeproposal.TeamID(demo.ID)).Count(ctx); n != 0 {
			t.Fatalf("proposals survived: %d", n)
		}
		if n, _ := d.Client.AssetSelection.Query().Where(assetselection.TeamID(demo.ID)).Count(ctx); n != 0 {
			t.Fatalf("asset choices survived: %d", n)
		}
		if n, _ := d.Client.PluginPackage.Query().Count(ctx); n != 1 {
			t.Fatalf("packages outside team were changed: %d", n)
		}
		if n, _ := d.Client.ResourceSubmission.Query().Count(ctx); n != 1 {
			t.Fatalf("submissions outside team were changed: %d", n)
		}
		if n, _ := d.Client.Artifact.Query().Where(artifact.TeamID(other.ID)).Count(ctx); n != 1 {
			t.Fatalf("other team's artifact changed: %d", n)
		}
		assertObject(t, ctx, store, demo.ID, "pages", userObject, false)
		assertObject(t, ctx, store, demo.ID, "knowledge", attachmentObject, false)
		assertObject(t, ctx, store, other.ID, "pages", otherObject, true)
		seedDigest := digestForTest(seed.Artifacts[0].Content)
		assertObject(t, ctx, store, demo.ID, "pages", seedDigest, true)

		if _, err := s.ResetTeamContent(ctx, demo.ID, demo.OwnerID, seed); err != nil {
			t.Fatal(err)
		}
		if n, _ := d.Client.Artifact.Query().Where(artifact.TeamID(demo.ID)).Count(ctx); n != 1 {
			t.Fatalf("repeated reset changed artifacts: %d", n)
		}
		current, err := d.Client.Team.Get(ctx, demo.ID)
		if err != nil || current.ContentGeneration != 3 {
			t.Fatalf("reset generations: %d, %v", current.ContentGeneration, err)
		}
	})
}

func TestResetTeamContentRollsBackInvalidReferences(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		ctx := context.Background()
		store := objectstore.Local{Dir: t.TempDir()}
		s := &Service{DB: d.Client, Objects: store}
		demo, err := s.CreateSystemTeam(ctx, edition.SystemTeamInput{ID: "demo", OwnerID: "demo-owner", OwnerName: "DSH Teamwork", Name: "Whale Studio", Locale: "en"})
		if err != nil {
			t.Fatal(err)
		}
		seed := testSeed()
		if _, err := s.ResetTeamContent(ctx, demo.ID, demo.OwnerID, seed); err != nil {
			t.Fatal(err)
		}
		invalid := testSeed()
		missing := "missing-model"
		invalid.Configs[0].Data = json.RawMessage(`{"modelConfigId":"` + missing + `"}`)
		if _, err := s.ResetTeamContent(ctx, demo.ID, demo.OwnerID, invalid); err == nil {
			t.Fatal("invalid model reference was accepted")
		}
		document, err := d.Client.KnowledgeDocument.Get(ctx, seed.Spaces[0].Documents[0].ID)
		if err != nil || document.Title != seed.Spaces[0].Documents[0].Title {
			t.Fatalf("previous seed was not rolled back: %#v, %v", document, err)
		}
	})
}

func testSeed() edition.TeamSeed {
	return edition.TeamSeed{Version: 1,
		Configs:   []edition.TeamConfigSeed{{ID: "seed-preset", Kind: "preset", Name: "Weekly report", Data: json.RawMessage(`{"inheritModel":true}`)}},
		Spaces:    []edition.KnowledgeSpaceSeed{{ID: "seed-space", Name: "Studio", Documents: []edition.KnowledgeDocumentSeed{{ID: "seed-document", Title: "Overview", Text: "# Overview"}}}},
		Artifacts: []edition.ArtifactSeed{{ID: "seed-artifact", Kind: "html", Title: "Dashboard", Content: []byte("<!doctype html><title>Demo</title>")}},
	}
}

func digestForTest(content []byte) string {
	sum := sha256.Sum256(content)
	return base64.RawURLEncoding.EncodeToString(sum[:24])
}

func putTestObject(t *testing.T, ctx context.Context, store objectstore.Local, teamID, kind string, content []byte) string {
	t.Helper()
	digest := digestForTest(content)
	if err := store.PutObject(ctx, teamID, kind, digest, bytes.NewReader(content), int64(len(content))); err != nil {
		t.Fatal(err)
	}
	return digest
}

func makeTestArtifact(t *testing.T, ctx context.Context, client *ent.Client, teamID, ownerID, id, digest string) {
	t.Helper()
	a := client.Artifact.Create().SetID(id).SetTeamID(teamID).SetOwnerID(ownerID).SetKind(artifact.KindHTML).
		SetTitle(id).SetSharing(artifact.SharingTeam).SetCurrentVersion(1).SaveX(ctx)
	v := client.ArtifactVersion.Create().SetArtifactID(a.ID).SetNumber(1).SetAuthorID(ownerID).SetSize(1).SaveX(ctx)
	client.ArtifactFile.Create().SetVersionID(v.ID).SetTeamID(teamID).SetPath("index.html").SetContentType("text/html").SetSize(1).SetDigest(digest).ExecX(ctx)
}

func assertObject(t *testing.T, ctx context.Context, store objectstore.Local, teamID, kind, digest string, want bool) {
	t.Helper()
	body, err := store.OpenObject(ctx, teamID, kind, digest)
	if err == nil {
		body.Close()
	}
	if want && err != nil {
		t.Fatalf("object %s is missing: %v", digest, err)
	}
	if !want && !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("object %s survives or returned the wrong error: %v", digest, err)
	}
}
