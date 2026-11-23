package team

import (
	"context"
	_ "embed"
	"encoding/json"
	"strings"

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
// Its name, description and prompt are written once, in the creator's
// language (wire.Locales; anything else reads English), and stay as written:
// they are the team's preset from then on, which its admin may edit. The
// prompt still asks the model to answer in each user's own language.
func provisionAssistant(ctx context.Context, client *ent.Client, teamID, teamName, locale string) error {
	var text struct {
		Name, Description, SystemPrompt map[string]string
	}
	if err := json.Unmarshal(assistantCopy, &text); err != nil {
		return err
	}
	if !wire.IsLocale(locale) {
		locale = "en"
	}
	name := strings.Replace(text.Name[locale], "{team}", teamName, 1)
	data := wire.PresetData{InheritModel: true, Avatar: "assistant", Description: text.Description[locale], SystemPrompt: text.SystemPrompt[locale], RequiredTools: []string{}, OptionalTools: []string{}, PluginDependencies: []wire.PluginDependency{}}
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	created, err := client.TeamConfig.Create().SetTeamID(teamID).SetKind("preset").SetName(name).SetBuiltin("team-assistant").SetData(encoded).Save(ctx)
	if err != nil {
		return err
	}
	return recordRevision(ctx, client, created, "", "", "Initial team assistant", "system")
}
