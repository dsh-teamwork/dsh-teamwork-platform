package schema

import (
	"encoding/json"
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ResourceSubmission freezes one proposal at submission; decisions never edit it.
type ResourceSubmission struct{ ent.Schema }

func (ResourceSubmission) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (ResourceSubmission) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32), field.String("author_id").MaxLen(32),
		field.String("config_id").MaxLen(32), field.Int("base_version").Default(0),
		field.JSON("proposal", json.RawMessage{}), field.String("note").MaxLen(runes(2000)).Default(""),
		field.Enum("state").Values("draft", "pending", "published", "rejected", "withdrawn").Default("draft"),
		field.Int("revision").Default(1), field.String("reviewer_id").MaxLen(32).Default(""),
		field.String("reason").MaxLen(runes(2000)).Default(""), field.Time("decided_at").SchemaType(mysqlTime).Optional().Nillable(),
	}
}
func (ResourceSubmission) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "author_id"), index.Fields("team_id", "state")}
}

// ConfigRevision is an immutable publication, retained after live config deletion.
type ConfigRevision struct{ ent.Schema }

func (ConfigRevision) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (ConfigRevision) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(), field.String("config_id").MaxLen(32).Immutable(),
		field.Int("version").Immutable(),
		field.String("builtin").MaxLen(40).Default("").Immutable(), field.Enum("kind").Values("model", "preset", "plugin").Immutable(),
		field.String("name").MaxLen(runes(120)).Immutable(), field.JSON("data", json.RawMessage{}).Immutable(),
		field.String("author_id").MaxLen(32).Default("").Immutable(), field.String("reviewer_id").MaxLen(32).Default("").Immutable(),
		field.String("note").MaxLen(runes(2000)).Default("").Immutable(),
		field.Enum("source").Values("system", "legacy", "direct", "approved").Immutable(),
	}
}
func (ConfigRevision) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "config_id", "version").Unique(), index.Fields("team_id", "created_at")}
}

// PluginPackage describes immutable bytes stored outside the public web root.
type PluginPackage struct{ ent.Schema }

func (PluginPackage) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (PluginPackage) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(), field.String("author_id").MaxLen(32).Immutable(),
		field.String("package").MaxLen(214).Immutable(), field.String("version").MaxLen(100).Immutable(),
		field.String("sha256").MaxLen(64).Immutable(), field.Int64("size").Immutable(),
		field.JSON("files", []string{}).Immutable(), field.Bool("published").Default(false),
	}
}
func (PluginPackage) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "package", "version").Unique(), index.Fields("team_id", "author_id")}
}

// AssetSelection is a member's choice of an asset or, with an empty user ID,
// the team's recommendation. A member's row follows the latest version, pins
// one, or removes the asset from their DSH; no row follows the recommendation.
type AssetSelection struct{ ent.Schema }

func (AssetSelection) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (AssetSelection) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("config_id").MaxLen(32).Immutable(),
		field.String("user_id").MaxLen(32).Immutable(),
		field.Int("version").Default(0),
		field.Enum("mode").Values("latest", "pinned", "removed").Default("pinned"),
		field.String("name").MaxLen(runes(120)).Default(""),
		field.JSON("history", []json.RawMessage{}).Optional(),
		field.Int("revision").Default(0),
	}
}
func (AssetSelection) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "user_id", "config_id").Unique()}
}

// AssetExclusion keeps one preset or plugin off one of a member's computers
// (a relay host): what the member has reaches every computer they sign in on
// except those named here, so a new computer starts with everything.
type AssetExclusion struct{ ent.Schema }

func (AssetExclusion) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (AssetExclusion) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("user_id").MaxLen(32).Immutable(),
		field.String("config_id").MaxLen(32).Immutable(),
		field.String("host_id").MaxLen(32).Immutable(),
	}
}
func (AssetExclusion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "user_id", "config_id", "host_id").Unique(), index.Fields("host_id")}
}
