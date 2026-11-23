package httpapi_test

import (
	"context"
	"strings"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestNewTeamHasOneInheritedAssistant(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		name := strings.Repeat("T", 100)
		id := newTeam(t, admin, name)
		rows := jsonArray(t, admin.get("/api/teams/"+id+"/configs"))
		if len(rows) != 1 {
			t.Fatalf("configs: %v", rows)
		}
		c := rows[0].(map[string]any)
		if c["builtin"] != "team-assistant" || c["name"] != name+" assistant" || c["data"].(map[string]any)["inheritModel"] != true {
			t.Fatalf("assistant: %v", c)
		}
		plugin := e.pluginFor(admin)
		for range 2 {
			must(t, plugin.get("/api/configs"), 200)
		}
		if n := d.Client.TeamConfig.Query().Where(teamconfig.TeamID(id)).CountX(context.Background()); n != 1 {
			t.Fatalf("sync duplicated assistant: %d", n)
		}
	})
}

// The assistant is named, described and prompted in the language the creator
// reads, chosen as the console's pages choose it, and keeps them when the
// creator switches.
func TestAssistantIsNamedInTheCreatorsLanguage(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		admin := e.admin("admin@x.io")
		must(t, admin.post("/api/locale", map[string]string{"locale": "zh-CN"}), 204)
		id := newTeam(t, admin, "Acme")
		c := jsonArray(t, admin.get("/api/teams/"+id+"/configs"))[0].(map[string]any)
		data := c["data"].(map[string]any)
		if c["name"] != "Acme\u56e2\u961f\u52a9\u7406" || !strings.Contains(data["description"].(string), "\u52a9\u7406") || !strings.HasPrefix(data["systemPrompt"].(string), "\u4f60\u662f") {
			t.Fatalf("zh-CN assistant: %v", c)
		}
		must(t, admin.post("/api/locale", map[string]string{"locale": "en"}), 204)
		if got := jsonArray(t, admin.get("/api/teams/"+id+"/configs"))[0].(map[string]any)["name"]; got != c["name"] {
			t.Fatalf("renamed on a language change: %v", got)
		}
		id = newTeam(t, admin, "Beta")
		c = jsonArray(t, admin.get("/api/teams/"+id+"/configs"))[0].(map[string]any)
		if c["name"] != "Beta assistant" || !strings.HasPrefix(c["data"].(map[string]any)["systemPrompt"].(string), "You are") {
			t.Fatalf("en assistant: %v", c)
		}
	})
}
