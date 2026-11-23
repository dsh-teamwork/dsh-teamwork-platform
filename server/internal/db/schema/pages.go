package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Page is what an agent published from a session: a titled, versioned thing
// one team owns (docs/tech/pages.md). Its files are under page_files, its
// bytes in the object store.
type Page struct{ ent.Schema }

func (Page) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (Page) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("owner_id").MaxLen(32).Immutable(),
		field.Enum("kind").Values("html", "markdown", "svg").Immutable(),
		field.String("title").MaxLen(runes(120)),
		field.Enum("sharing").Values("private", "members", "team").Default("private"),
		// current_version moves by a conditional update, never a lock.
		field.Int("current_version"),
		// updated_at is the newest version's time, which the lists sort by.
		field.Time("updated_at").SchemaType(mysqlTime).Default(now),
	}
}
func (Page) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "owner_id", "updated_at"), index.Fields("team_id", "sharing", "updated_at")}
}

// PageVersion is one immutable set of files of a page.
type PageVersion struct{ ent.Schema }

func (PageVersion) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (PageVersion) Fields() []ent.Field {
	return []ent.Field{
		field.String("page_id").MaxLen(32).Immutable(),
		field.Int("number").Immutable(),
		field.String("author_id").MaxLen(32).Immutable(),
		field.String("computer").MaxLen(runes(64)).Default("").Immutable(),
		field.String("session_id").MaxLen(128).Default("").Immutable(),
		field.String("note").MaxLen(runes(200)).Default("").Immutable(),
		field.Int64("size").Immutable(),
	}
}
func (PageVersion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("page_id", "number").Unique()}
}

// PageFile is one file of a version. digest names its object under the team:
// teams/{team_id}/pages/{digest}.
type PageFile struct{ ent.Schema }

func (PageFile) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (PageFile) Fields() []ent.Field {
	return []ent.Field{
		field.String("version_id").MaxLen(32).Immutable(),
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("path").MaxLen(255).Immutable(),
		field.String("content_type").MaxLen(100).Immutable(),
		field.Int64("size").Immutable(),
		field.String("digest").MaxLen(32).Immutable(),
	}
}
func (PageFile) Indexes() []ent.Index {
	return []ent.Index{index.Fields("version_id", "path").Unique(), index.Fields("team_id", "digest")}
}

// PageMember is one member a page is shared with; rows exist only while the
// page's sharing is "members".
type PageMember struct{ ent.Schema }

func (PageMember) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (PageMember) Fields() []ent.Field {
	return []ent.Field{
		field.String("page_id").MaxLen(32).Immutable(),
		field.String("user_id").MaxLen(32).Immutable(),
		field.String("added_by").MaxLen(32).Immutable(),
	}
}
func (PageMember) Indexes() []ent.Index {
	return []ent.Index{index.Fields("page_id", "user_id").Unique(), index.Fields("user_id", "page_id")}
}
