package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Artifact is what an agent published from a session: a titled, versioned thing
// one team owns (docs/tech/artifacts.md). Its files are under artifact_files, its
// bytes in the object store.
type Artifact struct{ ent.Schema }

func (Artifact) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (Artifact) Fields() []ent.Field {
	return []ent.Field{
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("owner_id").MaxLen(32).Immutable(),
		field.Enum("kind").Values("html", "svg").Immutable(),
		field.String("title").MaxLen(runes(120)),
		field.Enum("sharing").Values("private", "members", "team").Default("private"),
		// current_version moves by a conditional update, never a lock.
		field.Int("current_version"),
		// updated_at is the newest version's time, which the lists sort by.
		field.Time("updated_at").SchemaType(mysqlTime).Default(now),
	}
}
func (Artifact) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id", "owner_id", "updated_at"), index.Fields("team_id", "sharing", "updated_at")}
}

// ArtifactVersion is one immutable set of files of an artifact.
type ArtifactVersion struct{ ent.Schema }

func (ArtifactVersion) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (ArtifactVersion) Fields() []ent.Field {
	return []ent.Field{
		field.String("artifact_id").MaxLen(32).Immutable(),
		field.Int("number").Immutable(),
		field.String("author_id").MaxLen(32).Immutable(),
		field.String("computer").MaxLen(runes(64)).Default("").Immutable(),
		field.String("session_id").MaxLen(128).Default("").Immutable(),
		field.String("note").MaxLen(runes(200)).Default("").Immutable(),
		field.Int64("size").Immutable(),
	}
}
func (ArtifactVersion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("artifact_id", "number").Unique()}
}

// ArtifactFile is one file of a version. digest names its object under the team:
// teams/{team_id}/artifacts/{digest}.
type ArtifactFile struct{ ent.Schema }

func (ArtifactFile) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (ArtifactFile) Fields() []ent.Field {
	return []ent.Field{
		field.String("version_id").MaxLen(32).Immutable(),
		field.String("team_id").MaxLen(32).Immutable(),
		field.String("path").MaxLen(255).Immutable(),
		field.String("content_type").MaxLen(100).Immutable(),
		field.Int64("size").Immutable(),
		field.String("digest").MaxLen(32).Immutable(),
	}
}
func (ArtifactFile) Indexes() []ent.Index {
	return []ent.Index{index.Fields("version_id", "path").Unique(), index.Fields("team_id", "digest")}
}

// ArtifactMember is one member an artifact is shared with; rows exist only while the
// artifact's sharing is "members".
type ArtifactMember struct{ ent.Schema }

func (ArtifactMember) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (ArtifactMember) Fields() []ent.Field {
	return []ent.Field{
		field.String("artifact_id").MaxLen(32).Immutable(),
		field.String("user_id").MaxLen(32).Immutable(),
		field.String("added_by").MaxLen(32).Immutable(),
	}
}
func (ArtifactMember) Indexes() []ent.Index {
	return []ent.Index{index.Fields("artifact_id", "user_id").Unique(), index.Fields("user_id", "artifact_id")}
}
