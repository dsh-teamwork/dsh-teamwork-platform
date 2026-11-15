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
		if c["builtin"] != "team-assistant" || !strings.HasPrefix(c["name"].(string), name) || c["data"].(map[string]any)["inheritModel"] != true {
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
