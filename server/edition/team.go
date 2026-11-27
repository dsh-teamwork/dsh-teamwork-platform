package edition

import "encoding/json"

// SystemTeamInput describes a team owned by an account that cannot sign in.
// OwnerID is chosen by the edition and is reused when the team is provisioned
// again after an interrupted bootstrap.
type SystemTeamInput struct {
	ID        string
	OwnerID   string
	OwnerName string
	Name      string
	Locale    string
}

// SystemTeam is a provisioned team and its sign-in-less owner.
type SystemTeam struct {
	ID      string
	Name    string
	OwnerID string
}

// TeamSeed is the small, deliberately limited content shape an edition can
// restore into a team. Models, memberships, budgets and usage are not part of
// it. Version applies to every seeded resource and is raised when its content
// changes, so clients synchronize the new version.
type TeamSeed struct {
	Version   int
	Configs   []TeamConfigSeed
	Spaces    []KnowledgeSpaceSeed
	Artifacts []ArtifactSeed
}

// TeamConfigSeed is a team-owned preset or plugin. Built-in configurations,
// such as the team assistant, are left alone by a reset.
type TeamConfigSeed struct {
	ID   string
	Kind string
	Name string
	Data json.RawMessage
}

// KnowledgeSpaceSeed is a flat, team-readable space. Folders, attachments and
// member-specific access are outside this seed format.
type KnowledgeSpaceSeed struct {
	ID        string
	Name      string
	Documents []KnowledgeDocumentSeed
}

// KnowledgeDocumentSeed is one Markdown document at TeamSeed.Version.
type KnowledgeDocumentSeed struct {
	ID    string
	Title string
	Text  string
}

// ArtifactSeed is one team-shared, single-file HTML or SVG artifact.
type ArtifactSeed struct {
	ID      string
	Kind    string
	Title   string
	Content []byte
}

// TeamBudgetPolicy is the small budget shape a system team needs: one team or
// default-member daily/monthly point cap. Member overrides and token caps stay
// with the ordinary budget API.
type TeamBudgetPolicy struct {
	Scope    string
	Period   string
	Timezone string
	Points   string
}
