package schema

import (
	"encoding/json"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Team is a name; everything else hangs off it.
type Team struct{ ent.Schema }

func (Team) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (Team) Fields() []ent.Field {
	return []ent.Field{field.String("name").MaxLen(100)}
}
func (Team) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("memberships", Membership.Type).Annotations(cascade),
		edge.To("configs", TeamConfig.Type).Annotations(cascade),
		edge.To("providers", TeamProvider.Type).Annotations(cascade),
		edge.To("invites", Invite.Type).Annotations(cascade),
	}
}

// Membership is one person in one team (ADR 0013): the pair is the key.
type Membership struct{ ent.Schema }

func (Membership) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (Membership) Fields() []ent.Field {
	return []ent.Field{
		field.String("user_id").MaxLen(32),
		field.String("team_id").MaxLen(32),
		field.Enum("role").Values("admin", "member"),
	}
}
func (Membership) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("memberships").Field("user_id").Unique().Required(),
		edge.From("team", Team.Type).Ref("memberships").Field("team_id").Unique().Required(),
	}
}
func (Membership) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "team_id").Unique(), index.Fields("team_id")}
}

// TeamConfig is a model, preset or plugin a team publishes. Data is the
// kind's shape, validated on every write and stored as the JSON it was given.
type TeamConfig struct{ ent.Schema }

func (TeamConfig) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (TeamConfig) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.Enum("kind").Values("model", "preset", "plugin"),
		field.String("name").MaxLen(100),
		field.JSON("data", json.RawMessage{}),
		field.Int("version").Default(1),
	}
}
func (TeamConfig) Edges() []ent.Edge {
	return []ent.Edge{edge.From("team", Team.Type).Ref("configs").Field("team_id").Unique().Required()}
}
func (TeamConfig) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "kind", "name").Unique()}
}

// TeamProvider is a team's model provider (ADR 0006): the address its admin
// entered and the key sealed under PROVIDER_KEYS_SECRET, never stored in clear.
type TeamProvider struct{ ent.Schema }

func (TeamProvider) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (TeamProvider) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.String("name").MaxLen(100),
		field.String("base_url").MaxLen(500),
		field.Text("key_cipher"),
	}
}
func (TeamProvider) Edges() []ent.Edge {
	return []ent.Edge{edge.From("team", Team.Type).Ref("providers").Field("team_id").Unique().Required()}
}
func (TeamProvider) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "name").Unique()}
}

// Invite is a single-use invitation, stored as the SHA-256 of its token.
type Invite struct{ ent.Schema }

func (Invite) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (Invite) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.String("token_hash").MaxLen(64).Unique(),
		field.Time("expires_at").SchemaType(mysqlTime),
		field.Time("used_at").SchemaType(mysqlTime).Optional().Nillable(),
	}
}
func (Invite) Edges() []ent.Edge {
	return []ent.Edge{edge.From("team", Team.Type).Ref("invites").Field("team_id").Unique().Required()}
}
func (Invite) Indexes() []ent.Index { return []ent.Index{index.Fields("team_id")} }
