package knowledge

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgecomment"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Comment is a comment as a document lists it (docs/tech/knowledge.md,
// "Comments"): a thread's first comment places it with its version, quote
// and anchor; a reply names its thread as its parent and places nothing.
type Comment struct {
	ID         string  `json:"id"`
	ParentID   string  `json:"parentId"`
	Version    int     `json:"version"`
	Quote      string  `json:"quote"`
	Anchor     string  `json:"anchor"`
	Body       string  `json:"body"`
	Author     Person  `json:"author"`
	CreatedAt  string  `json:"createdAt"`
	ResolvedBy *Person `json:"resolvedBy"`
	ResolvedAt *string `json:"resolvedAt"`
	// CanResolve is a thread's, for its author and its space's editors;
	// CanDelete is the comment's author's and the editors'.
	CanResolve bool `json:"canResolve"`
	CanDelete  bool `json:"canDelete"`
}

// CommentInput opens a thread on Quote in Version, under the heading Anchor,
// or replies to ParentID.
type CommentInput struct {
	ParentID string `json:"parentId"`
	Version  int    `json:"version"`
	Quote    string `json:"quote"`
	Anchor   string `json:"anchor"`
	Body     string `json:"body"`
}

// maxComment is the most characters a comment's body holds.
const maxComment = 4000

// Comments is every comment on a document the caller reads, oldest first.
func (s *Service) Comments(ctx context.Context, c Caller, teamID, documentID string) ([]Comment, error) {
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.KnowledgeComment.Query().Where(knowledgecomment.DocumentID(d.ID)).
		Order(ent.Asc(knowledgecomment.FieldCreatedAt), ent.Asc(knowledgecomment.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for _, r := range rows {
		ids[r.AuthorID] = true
		if r.ResolvedBy != "" {
			ids[r.ResolvedBy] = true
		}
	}
	people, err := s.people(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]Comment, 0, len(rows))
	for _, r := range rows {
		out = append(out, commentView(r, people, c, a))
	}
	return out, nil
}

func commentView(r *ent.KnowledgeComment, people map[string]Person, c Caller, a access) Comment {
	mine := r.AuthorID == c.UserID && !c.Agent
	v := Comment{
		ID: r.ID, ParentID: r.ParentID, Version: r.Version, Quote: r.Quote, Anchor: r.Anchor, Body: r.Body,
		Author: people[r.AuthorID], CreatedAt: team.Time(r.CreatedAt),
		CanResolve: r.ParentID == "" && (mine || a.edit) && !c.Agent,
		CanDelete:  mine || (a.edit && !c.Agent),
	}
	if r.ResolvedAt != nil {
		by := people[r.ResolvedBy]
		at := team.Time(*r.ResolvedAt)
		v.ResolvedBy, v.ResolvedAt = &by, &at
	}
	return v
}

// AddComment opens a thread or replies to one; any reader's, never an
// agent's, since a comment speaks for a person.
func (s *Service) AddComment(ctx context.Context, c Caller, teamID, documentID string, in CommentInput) (Comment, error) {
	if c.Agent {
		return Comment{}, agentProposes()
	}
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Comment{}, err
	}
	body := strings.TrimSpace(in.Body)
	if body == "" || utf8.RuneCountInString(body) > maxComment {
		return Comment{}, invalid("A comment of 1 to "+itoa(maxComment)+" characters", "body")
	}
	q := s.DB.KnowledgeComment.Create().SetTeamID(teamID).SetDocumentID(d.ID).SetAuthorID(c.UserID).SetBody(body).SetCreatedAt(s.now())
	if in.ParentID != "" {
		parent, err := s.DB.KnowledgeComment.Query().Where(knowledgecomment.ID(in.ParentID), knowledgecomment.DocumentID(d.ID), knowledgecomment.ParentID("")).Only(ctx)
		if ent.IsNotFound(err) {
			return Comment{}, notFound()
		}
		if err != nil {
			return Comment{}, err
		}
		// A reply belongs to its thread's place.
		q.SetParentID(parent.ID).SetVersion(parent.Version)
	} else {
		quote := strings.TrimSpace(in.Quote)
		if utf8.RuneCountInString(quote) > 500 {
			return Comment{}, invalid("A quote of at most 500 characters", "quote")
		}
		if utf8.RuneCountInString(in.Anchor) > 200 {
			return Comment{}, invalid("An anchor of at most 200 characters", "anchor")
		}
		if in.Version < 1 || in.Version > d.CurrentVersion {
			return Comment{}, invalid("A version of the document", "version")
		}
		q.SetVersion(in.Version).SetQuote(quote).SetAnchor(in.Anchor)
	}
	r, err := q.Save(ctx)
	if err != nil {
		return Comment{}, err
	}
	people, err := s.people(ctx, map[string]bool{c.UserID: true})
	if err != nil {
		return Comment{}, err
	}
	return commentView(r, people, c, a), nil
}

// comment is a comment of teamID on a document the caller reads, and their
// standing to its space.
func (s *Service) comment(ctx context.Context, c Caller, teamID, commentID string) (*ent.KnowledgeComment, access, error) {
	r, err := s.DB.KnowledgeComment.Query().Where(knowledgecomment.ID(commentID), knowledgecomment.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		if _, err := s.member(ctx, c, teamID); err != nil {
			return nil, access{}, err
		}
		return nil, access{}, notFound()
	}
	if err != nil {
		return nil, access{}, err
	}
	_, a, err := s.document(ctx, c, teamID, r.DocumentID)
	if err != nil {
		return nil, access{}, err
	}
	return r, a, nil
}

// ResolveComment marks a thread resolved, or open again; its author's or an
// editor's.
func (s *Service) ResolveComment(ctx context.Context, c Caller, teamID, commentID string, resolved bool) error {
	if c.Agent {
		return agentProposes()
	}
	r, a, err := s.comment(ctx, c, teamID, commentID)
	if err != nil {
		return err
	}
	if r.ParentID != "" {
		return wire.E(http.StatusConflict, "knowledge_comment_reply")
	}
	if r.AuthorID != c.UserID && !a.edit {
		return notEditor()
	}
	u := r.Update()
	if resolved {
		u.SetResolvedBy(c.UserID).SetResolvedAt(s.now())
	} else {
		u.SetResolvedBy("").ClearResolvedAt()
	}
	return u.Exec(ctx)
}

// DeleteComment deletes a comment, and a thread's first its replies with
// it; its author's or an editor's.
func (s *Service) DeleteComment(ctx context.Context, c Caller, teamID, commentID string) error {
	if c.Agent {
		return agentProposes()
	}
	r, a, err := s.comment(ctx, c, teamID, commentID)
	if err != nil {
		return err
	}
	if r.AuthorID != c.UserID && !a.edit {
		return notEditor()
	}
	_, err = s.DB.KnowledgeComment.Delete().Where(knowledgecomment.Or(knowledgecomment.ID(r.ID), knowledgecomment.ParentID(r.ID))).Exec(ctx)
	return err
}

// deleteComments removes every comment on the documents, in a caller's
// transaction.
func deleteComments(ctx context.Context, db *ent.Client, documentIDs []string) error {
	_, err := db.KnowledgeComment.Delete().Where(knowledgecomment.DocumentIDIn(documentIDs...)).Exec(ctx)
	return err
}
