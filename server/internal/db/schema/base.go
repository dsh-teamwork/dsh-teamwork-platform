// Package schema is the one definition of every table, for all three
// dialects (docs/tech/go-server.md, "Rules for the data layer"). Migrations
// for SQLite, Postgres and MySQL are generated from it; see internal/db.
package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/mixin"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
)

// mysqlTime goes on every time column: it keeps microseconds and dates past
// 2038 on MySQL, whose default TIMESTAMP keeps neither.
var mysqlTime = map[string]string{dialect.MySQL: "datetime(6)"}

func now() time.Time { return time.Now().UTC() }

// Base gives a table its application-generated id and creation time, and on
// MySQL a binary collation, so a unique name means the same thing everywhere.
type Base struct{ mixin.Schema }

func (Base) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").DefaultFunc(ids.New).Immutable().NotEmpty().MaxLen(32),
		field.Time("created_at").SchemaType(mysqlTime).Default(now).Immutable(),
	}
}

func (Base) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Charset: "utf8mb4", Collation: "utf8mb4_bin"}}
}

// Updated adds an update time, moved on every write.
type Updated struct{ mixin.Schema }

func (Updated) Fields() []ent.Field {
	return []ent.Field{field.Time("updated_at").SchemaType(mysqlTime).Default(now).UpdateDefault(now)}
}

// cascade deletes the rows that point at a parent with it.
var cascade = entsql.OnDelete(entsql.Cascade)

// runes is the column size for a field the API limits to n characters. ent's
// MaxLen counts bytes, and a character is up to four in UTF-8, so a limit in
// characters is the API's (internal/wire) and the column only has to hold it.
func runes(n int) int { return 4 * n }
