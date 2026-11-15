package team

import (
	"context"
	_ "embed"
	"encoding/json"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

//go:embed assistant.json
var assistantCopy []byte

func builtinName(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// provisionAssistant belongs to the team creation transaction, not a sync hook.
func provisionAssistant(ctx context.Context, client *ent.Client, teamID, teamName string) error {
	var text struct{ Suffix, Description, SystemPrompt string }
	if err := json.Unmarshal(assistantCopy, &text); err != nil {
		return err
	}
	data := wire.PresetData{InheritModel: true, Description: text.Description, SystemPrompt: text.SystemPrompt, RequiredTools: []string{}, OptionalTools: []string{}, PluginDependencies: []wire.PluginDependency{}}
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	created, err := client.TeamConfig.Create().SetTeamID(teamID).SetKind("preset").SetName(teamName + text.Suffix).SetBuiltin("team-assistant").SetData(encoded).Save(ctx)
	if err != nil {
		return err
	}
	return recordRevision(ctx, client, created, "", "", "Initial team assistant", "system")
}
