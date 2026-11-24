package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// KnowledgeSpace is a top-level folder of a team's knowledge, the one thing
// that carries access (docs/tech/knowledge.md, "Terms").
type KnowledgeSpace struct{ ent.Schema }

func (KnowledgeSpace) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeSpace) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("name").MaxLen(runes(80)),
		// reading is who reads it: every member of the team, or the members
		// knowledge_space_members names.
		field.Enum("reading").Values("team", "members").Default("team"),
		field.String("created_by").MaxLen(32).Immutable(),
	}
}
func (KnowledgeSpace) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "name").Unique()}
}

// KnowledgeSpaceMember is one member a space names: an editor always, a
// reader only while the space's reading is "members".
type KnowledgeSpaceMember struct{ ent.Schema }

func (KnowledgeSpaceMember) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeSpaceMember) Fields() []ent.Field {
	return []ent.Field{
		field.String("space_id").MaxLen(32).Immutable(),
		field.String("user_id").MaxLen(32).Immutable(),
		field.Enum("role").Values("reader", "editor"),
	}
}
func (KnowledgeSpaceMember) Indexes() []ent.Index {
	return []ent.Index{index.Fields("space_id", "user_id").Unique(), index.Fields("user_id")}
}

// KnowledgeFolder is a folder inside a space, for order only.
type KnowledgeFolder struct{ ent.Schema }

func (KnowledgeFolder) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeFolder) Fields() []ent.Field {
	return []ent.Field{
		field.String("space_id").MaxLen(32).Immutable(),
		// parent_id is empty at the space's root.
		field.String("parent_id").MaxLen(32).Default(""),
		field.String("name").MaxLen(runes(80)),
	}
}
func (KnowledgeFolder) Indexes() []ent.Index {
	return []ent.Index{index.Fields("space_id", "parent_id", "name").Unique()}
}

// KnowledgeDocument is one Markdown document of a space.
type KnowledgeDocument struct{ ent.Schema }

func (KnowledgeDocument) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeDocument) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("space_id").MaxLen(32),
		// folder_id is empty at the space's root.
		field.String("folder_id").MaxLen(32).Default(""),
		field.String("title").MaxLen(runes(120)),
		// current_version moves by a conditional update, never a lock.
		field.Int("current_version"),
		field.Time("updated_at").SchemaType(mysqlTime).Default(now),
	}
}
func (KnowledgeDocument) Indexes() []ent.Index {
	return []ent.Index{index.Fields("space_id", "folder_id", "title").Unique(), index.Fields("team_id", "updated_at")}
}

// KnowledgeVersion is one immutable text of a document.
type KnowledgeVersion struct{ ent.Schema }

func (KnowledgeVersion) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeVersion) Fields() []ent.Field {
	return []ent.Field{
		field.String("document_id").MaxLen(32).Immutable(),
		field.Int("number").Immutable(),
		field.String("author_id").MaxLen(32).Immutable(),
		// source is where it came from: a person in the console, or an
		// agent's proposal a person accepted.
		field.Enum("source").Values("console", "agent").Immutable(),
		// computer and session_id say where an agent's accepted proposal came from.
		field.String("computer").MaxLen(runes(64)).Default("").Immutable(),
		field.String("session_id").MaxLen(128).Default("").Immutable(),
		field.String("note").MaxLen(runes(200)).Default("").Immutable(),
		field.Text("text").Immutable(),
	}
}
func (KnowledgeVersion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("document_id", "number").Unique()}
}

// KnowledgeProposal is a change to a document not yet in it: a reader's save,
// or any agent's (docs/tech/knowledge.md, "Rules").
type KnowledgeProposal struct{ ent.Schema }

func (KnowledgeProposal) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeProposal) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("document_id").MaxLen(32).Immutable(),
		field.Int("base_version").Immutable(),
		field.String("author_id").MaxLen(32).Immutable(),
		field.Enum("source").Values("console", "agent").Immutable(),
		field.String("computer").MaxLen(runes(64)).Default("").Immutable(),
		field.String("session_id").MaxLen(128).Default("").Immutable(),
		field.String("note").MaxLen(runes(200)).Default("").Immutable(),
		field.Text("text").Immutable(),
		// state moves once, from pending, by a conditional update.
		field.Enum("state").Values("pending", "accepted", "declined", "withdrawn").Default("pending"),
		field.String("decided_by").MaxLen(32).Default(""),
		field.Time("decided_at").SchemaType(mysqlTime).Optional().Nillable(),
		field.String("reason").MaxLen(runes(500)).Default(""),
		// version is the number an acceptance made.
		field.Int("version").Default(0),
	}
}
func (KnowledgeProposal) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "state", "created_at"), index.Fields("document_id", "state")}
}

// KnowledgeAttachment is a file a document names by its name, `![[name]]` or
// `[[name]]` (docs/tech/knowledge.md, "Format"). A name, once uploaded, keeps
// its bytes for the document's life, so every version that names it shows
// the same file; the bytes are an object of the team, by digest.
type KnowledgeAttachment struct{ ent.Schema }

func (KnowledgeAttachment) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (KnowledgeAttachment) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("document_id").MaxLen(32).Immutable(),
		field.String("name").MaxLen(runes(120)).Immutable(),
		field.String("content_type").MaxLen(100).Immutable(),
		field.Int64("size").Immutable(),
		field.String("digest").MaxLen(32).Immutable(),
		field.String("created_by").MaxLen(32).Immutable(),
	}
}
func (KnowledgeAttachment) Indexes() []ent.Index {
	return []ent.Index{index.Fields("document_id", "name").Unique(), index.Fields("team_id", "digest")}
}
