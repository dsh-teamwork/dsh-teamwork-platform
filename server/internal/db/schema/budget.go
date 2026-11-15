package schema

import (
	"encoding/json"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// BudgetGate serializes short policy/admission transactions within a team.
// Its id is the team's id, without a cascade to operational team records.
type BudgetGate struct{ ent.Schema }

func (BudgetGate) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (BudgetGate) Fields() []ent.Field {
	return []ent.Field{field.Int64("revision").Default(0)}
}

type BudgetPolicy struct{ ent.Schema }

func (BudgetPolicy) Mixin() []ent.Mixin { return []ent.Mixin{Base{}, Updated{}} }
func (BudgetPolicy) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.Enum("scope").Values("team", "member", "default_member", "provider"),
		field.String("subject_id").MaxLen(runes(100)).Default(""),
		field.Enum("period").Values("day", "month"),
		field.String("timezone").MaxLen(100),
		field.String("previous_timezone").MaxLen(100).Default(""),
		field.Time("timezone_effective_at").SchemaType(mysqlTime).Optional().Nillable(),
		field.Int64("point_limit").NonNegative().Optional().Nillable(),
		field.Int64("input_limit").NonNegative().Optional().Nillable(),
		field.Int64("output_limit").NonNegative().Optional().Nillable(),
		field.Int64("total_limit").NonNegative().Optional().Nillable(),
		field.Bool("enabled").Default(true),
		field.Enum("notify").Values("admins", "owner", "both", "none").Default("admins"),
		field.Int("revision").Default(1).Positive(),
	}
}
func (BudgetPolicy) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "scope", "subject_id", "period").Unique()}
}

// BudgetWindow identifies the effective scope, not the selected policy. A
// member override therefore continues the default member's existing spend.
type BudgetWindow struct{ ent.Schema }

func (BudgetWindow) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (BudgetWindow) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.Enum("scope").Values("team", "member", "provider"),
		field.String("subject_id").MaxLen(runes(100)).Default(""),
		field.Enum("period").Values("day", "month"),
		field.Time("starts_at").SchemaType(mysqlTime),
		field.Time("ends_at").SchemaType(mysqlTime),
		field.Int64("spent_units").Default(0),
		field.Int64("reserved_units").Default(0),
		field.Int64("spent_input").Default(0),
		field.Int64("reserved_input").Default(0),
		field.Int64("spent_output").Default(0),
		field.Int64("reserved_output").Default(0),
		field.Int64("unpriced_count").Default(0),
		field.Int64("unbounded_count").Default(0),
	}
}
func (BudgetWindow) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("team_id", "scope", "subject_id", "period", "starts_at").Unique(),
		index.Fields("team_id", "ends_at"),
	}
}

type BudgetReservation struct{ ent.Schema }

func (BudgetReservation) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (BudgetReservation) Fields() []ent.Field {
	return []ent.Field{
		field.String("request_id").MaxLen(32),
		field.String("window_id").MaxLen(32),
		field.String("policy_id").MaxLen(32),
		field.Int("policy_revision"),
		field.Int64("point_units").Default(0),
		field.Int64("input_tokens").Default(0),
		field.Int64("output_tokens").Default(0),
		field.Bool("unbounded").Default(false),
		field.Bool("unpriced").Default(false),
		field.Bool("settled").Default(false),
	}
}
func (BudgetReservation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("request_id", "window_id").Unique(), index.Fields("window_id", "settled")}
}

// BudgetEvent is append-only policy/reservation/settlement evidence. It supports
// counter rebuilding and records explicit reasons for later manual resolutions.
type BudgetEvent struct{ ent.Schema }

func (BudgetEvent) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (BudgetEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.String("window_id").MaxLen(32).Default(""),
		field.String("request_id").MaxLen(32).Default(""),
		field.String("policy_id").MaxLen(32).Default(""),
		field.String("action_key").MaxLen(150).Unique(),
		field.String("actor_id").MaxLen(32).Default(""),
		field.Enum("kind").Values("policy", "reserve", "settle", "resolve", "pending", "late_usage"),
		field.JSON("data", json.RawMessage{}),
	}
}
func (BudgetEvent) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "created_at"), index.Fields("window_id", "created_at")}
}

// BudgetNotice is a durable transactional alert outbox. Financial/budget
// effects do not depend on delivery. SMTP remains at-least-once delivery.
type BudgetNotice struct{ ent.Schema }

func (BudgetNotice) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (BudgetNotice) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.String("window_id").MaxLen(32),
		field.String("recipient_id").MaxLen(32),
		field.Int("threshold"),
		field.JSON("data", json.RawMessage{}),
		field.Enum("state").Values("pending", "sending", "sent", "failed", "skipped").Default("pending"),
		field.String("lease_id").MaxLen(32).Default(""),
		field.Time("lease_until").SchemaType(mysqlTime).Optional().Nillable(),
		field.Time("next_at").SchemaType(mysqlTime).Default(now),
		field.Int("attempts").Default(0),
		field.String("last_error").MaxLen(64).Default(""),
	}
}
func (BudgetNotice) Indexes() []ent.Index {
	return []ent.Index{index.Fields("window_id", "recipient_id", "threshold").Unique(), index.Fields("state", "next_at")}
}
