package schema

import (
	"encoding/json"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ModelRate is an immutable reference-price version, owned by its team.
type ModelRate struct{ ent.Schema }

func (ModelRate) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (ModelRate) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.String("config_id").MaxLen(32),
		field.String("provider").MaxLen(runes(100)),
		field.String("model").MaxLen(runes(100)),
		field.Int("revision").Positive(),
		field.Enum("basis").Values("cost", "weight"),
		field.Int64("input_rate").NonNegative(),
		field.Int64("cache_read_rate").NonNegative(),
		field.Int64("cache_write_rate").NonNegative(),
		field.Int64("output_rate").NonNegative(),
		field.String("actor_id").MaxLen(32),
	}
}
func (ModelRate) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "config_id", "revision").Unique()}
}

// UsageRequest retains attributable facts after a member/config is removed;
// these references deliberately have no cascading edges to operational rows.
type UsageRequest struct{ ent.Schema }

func (UsageRequest) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (UsageRequest) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32),
		field.String("user_id").MaxLen(32),
		field.String("submitted_config_id").MaxLen(32),
		field.String("config_id").MaxLen(32),
		field.String("provider").MaxLen(runes(100)),
		field.String("model").MaxLen(runes(100)),
		field.Bool("stream"),
		field.Enum("state").Values("running", "settled", "unpriced", "pending", "failed").Default("running"),
		field.String("rate_id").MaxLen(32).Default(""),
		field.JSON("rates", json.RawMessage{}).Optional(),
		field.Int64("point_units").Optional().Nillable(),
		field.Int64("input_tokens").Optional().Nillable(),
		field.Int64("cache_read_tokens").Optional().Nillable(),
		field.Int64("cache_write_tokens").Optional().Nillable(),
		field.Int64("output_tokens").Optional().Nillable(),
		field.Int64("reasoning_tokens").Optional().Nillable(),
		field.String("provider_request_id").MaxLen(200).Default(""),
		field.String("error_code").MaxLen(64).Default(""),
		field.Time("finished_at").SchemaType(mysqlTime).Optional().Nillable(),
	}
}
func (UsageRequest) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("team_id", "created_at"),
		index.Fields("team_id", "user_id", "created_at"),
		index.Fields("team_id", "config_id", "created_at"),
		index.Fields("state", "created_at"),
	}
}
