package httpapi_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func pluginArchive(t *testing.T, extra string) []byte {
	t.Helper()
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tw := tar.NewWriter(gz)
	files := map[string]string{"package/package.json": `{"name":"@test/private","version":"1.0.0","main":"index.js"}`, "package/index.js": "export function apply() {}"}
	if extra != "" {
		files[extra] = "private content"
	}
	for name, content := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0600, Size: int64(len(content))}); err != nil {
			t.Fatal(err)
		}
		tw.Write([]byte(content))
	}
	tw.Close()
	gz.Close()
	return b.Bytes()
}
func TestPrivateArtifactPublicationAccess(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		a, _ := e.person("a@x.io")
		b, _ := e.person("b@x.io")
		teamID := newTeam(t, admin, "Packages")
		for _, person := range []*browser{a, b} {
			_, token := invite(t, admin, teamID)
			must(t, person.post("/api/invites/redeem", map[string]string{"token": token}), 200)
		}
		base := "/api/teams/" + teamID
		archive := pluginArchive(t, "")
		uploaded := must(t, a.post(base+"/artifacts", string(archive)), 200)
		artifactID := uploaded["id"].(string)
		refused(t, "unpublished artifact", b.get(base+"/artifacts/"+artifactID), 404, "artifact_not_found")
		config := map[string]any{"kind": "plugin", "name": "Private plugin", "data": map[string]any{"package": uploaded["package"], "version": uploaded["version"], "artifactId": artifactID, "sha256": uploaded["sha256"]}}
		draft := must(t, a.post(base+"/submissions", map[string]any{"config": config, "baseVersion": 0, "note": "Checked files"}), 200)
		path := base + "/submissions/" + draft["id"].(string)
		pending := must(t, a.post(path+"/submit", map[string]any{"revision": draft["revision"]}), 200)
		must(t, admin.post(path+"/approve", map[string]any{"revision": pending["revision"]}), 200)
		metadata := must(t, b.get(base+"/artifacts/"+artifactID), 200)
		if metadata["published"] != true {
			t.Fatal("artifact not published")
		}
		downloaded := b.get(base + "/artifacts/" + artifactID + "/download")
		if downloaded.status != 200 || !bytes.Equal(downloaded.body, archive) {
			t.Fatalf("download: %d", downloaded.status)
		}
	})
}
func TestUnsafePluginArchives(t *testing.T) {
	for _, name := range []string{"package/.env", "package/../outside", "/outside", "package/.ssh/id_rsa"} {
		if _, _, _, err := team.InspectArtifact(bytes.NewReader(pluginArchive(t, name))); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	broken := pluginArchive(t, "")
	broken[len(broken)-1] ^= 1
	if _, _, _, err := team.InspectArtifact(bytes.NewReader(broken)); err == nil {
		t.Fatal("accepted invalid gzip checksum")
	}
}
