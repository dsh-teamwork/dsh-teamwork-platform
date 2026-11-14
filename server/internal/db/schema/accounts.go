package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// User is one person's profile. An account is not its email (ADR 0014): the
// ways it signs in are its identities, and a door that verifies no email
// (Feishu) leaves Email empty.
type User struct{ ent.Schema }

func (User) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("email").Optional().Nillable().Unique(),
		field.String("name").Optional().Nillable().MaxLen(80),
		field.String("image").Optional().Nillable().MaxLen(2048),
		field.String("locale").Optional().Nillable().MaxLen(16),
	}
}
func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("identities", Identity.Type).Annotations(cascade),
		edge.To("password", Password.Type).Unique().Annotations(cascade),
		edge.To("memberships", Membership.Type).Annotations(cascade),
	}
}

// Identity is one way into an account: a provider and the subject it proves.
// An emailed code and a password both prove the lower-cased email, as
// provider "email"; Google proves its `sub`, Feishu its `union_id`.
type Identity struct{ ent.Schema }

func (Identity) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (Identity) Fields() []ent.Field {
	return []ent.Field{
		field.String("provider").MaxLen(32),
		field.String("subject"),
		field.String("user_id").MaxLen(32),
	}
}
func (Identity) Edges() []ent.Edge {
	return []ent.Edge{edge.From("user", User.Type).Ref("identities").Field("user_id").Unique().Required()}
}
func (Identity) Indexes() []ent.Index {
	return []ent.Index{index.Fields("provider", "subject").Unique(), index.Fields("user_id")}
}

// Password is a user's scrypt hash, where the instance sends no email
// (ADR 0006), with the guesses counted against it in the current window.
type Password struct{ ent.Schema }

func (Password) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (Password) Fields() []ent.Field {
	return []ent.Field{
		field.String("user_id").MaxLen(32).Unique(),
		field.String("hash").MaxLen(512),
		field.Bool("must_change").Default(false),
		field.Int("failures").Default(0),
		field.Time("failures_since").SchemaType(mysqlTime).Optional().Nillable(),
	}
}
func (Password) Edges() []ent.Edge {
	return []ent.Edge{edge.From("user", User.Type).Ref("password").Field("user_id").Unique().Required()}
}

// VerificationCode is one emailed code, stored as an HMAC; its checks are
// spent by a conditional update before the comparison.
type VerificationCode struct{ ent.Schema }

func (VerificationCode) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (VerificationCode) Fields() []ent.Field {
	return []ent.Field{
		field.String("email"),
		field.String("code_hash").MaxLen(64),
		field.Int("attempts").Default(0),
		field.Time("expires_at").SchemaType(mysqlTime),
	}
}
func (VerificationCode) Indexes() []ent.Index { return []ent.Index{index.Fields("email", "created_at")} }

// RateWindow counts events per key in a fixed window, such as the codes sent
// to one address.
type RateWindow struct{ ent.Schema }

func (RateWindow) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (RateWindow) Fields() []ent.Field {
	return []ent.Field{
		field.String("key").Unique(),
		field.Time("window_start").SchemaType(mysqlTime),
		field.Int("count").Default(0),
	}
}
