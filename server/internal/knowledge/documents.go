package knowledge

import (
	"context"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeattachment"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgedocument"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgefolder"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeproposal"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
)

// Person is someone a document names: a version's or a proposal's author.
type Person struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Email *string `json:"email"`
}

// VersionView is one version as a document lists it.
type VersionView struct {
	Number    int    `json:"number"`
	Author    Person `json:"author"`
	Source    string `json:"source"`
	Computer  string `json:"computer"`
	SessionID string `json:"sessionId"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
}

// Document is one document: where it is, its versions newest first, and the
// text of the version asked for.
type Document struct {
	DocumentSummary
	SpaceID  string        `json:"spaceId"`
	CanEdit  bool          `json:"canEdit"`
	Version  int           `json:"version"`
	Text     string        `json:"text"`
	Versions []VersionView `json:"versions"`
	// Attachments are the files the document may name, every version alike.
	Attachments []Attachment `json:"attachments"`
	// Backlinks are the documents the caller reads whose current text links
	// here, whichever version is asked for.
	Backlinks []Backlink `json:"backlinks"`
}

// DocumentInput makes a document.
type DocumentInput struct {
	SpaceID  string `json:"spaceId"`
	FolderID string `json:"folderId"`
	Title    string `json:"title"`
	Text     string `json:"text"`
	Note     string `json:"note"`
}

// VersionInput is a new text on top of BaseVersion.
type VersionInput struct {
	BaseVersion int    `json:"baseVersion"`
	Text        string `json:"text"`
	Note        string `json:"note"`
}

// DocumentPatch renames or moves a document within its space.
type DocumentPatch struct {
	Title    *string `json:"title"`
	FolderID *string `json:"folderId"`
}

// document is a document of teamID the caller reads, and their standing to
// its space.
func (s *Service) document(ctx context.Context, c Caller, teamID, documentID string) (*ent.KnowledgeDocument, access, error) {
	d, err := s.DB.KnowledgeDocument.Query().Where(knowledgedocument.ID(documentID), knowledgedocument.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		// A team the caller is not in answers as a team, not as a document.
		if _, err := s.member(ctx, c, teamID); err != nil {
			return nil, access{}, err
		}
		return nil, access{}, notFound()
	}
	if err != nil {
		return nil, access{}, err
	}
	a, err := s.space(ctx, c, teamID, d.SpaceID)
	if err != nil {
		return nil, access{}, err
	}
	return d, a, nil
}

func (s *Service) inFolder(ctx context.Context, spaceID, folderID string) error {
	if folderID == "" {
		return nil
	}
	ok, err := s.DB.KnowledgeFolder.Query().Where(knowledgefolder.ID(folderID), knowledgefolder.SpaceID(spaceID)).Exist(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return notFound()
	}
	return nil
}

// CreateDocument makes a document and its version 1; an editor's.
func (s *Service) CreateDocument(ctx context.Context, c Caller, teamID string, in DocumentInput) (Document, error) {
	if _, err := s.editing(ctx, c, teamID, in.SpaceID); err != nil {
		return Document{}, err
	}
	title, err := name(in.Title, 120, "title")
	if err != nil {
		return Document{}, err
	}
	n, err := note(in.Note)
	if err != nil {
		return Document{}, err
	}
	if err := text(in.Text); err != nil {
		return Document{}, err
	}
	if err := s.inFolder(ctx, in.SpaceID, in.FolderID); err != nil {
		return Document{}, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback()
	at := s.now()
	d, err := tx.KnowledgeDocument.Create().SetTeamID(teamID).SetSpaceID(in.SpaceID).SetFolderID(in.FolderID).
		SetTitle(title).SetCurrentVersion(1).SetUpdatedAt(at).Save(ctx)
	if ent.IsConstraintError(err) {
		return Document{}, taken()
	}
	if err != nil {
		return Document{}, err
	}
	if err := tx.KnowledgeVersion.Create().SetDocumentID(d.ID).SetNumber(1).SetAuthorID(c.UserID).
		SetSource(knowledgeversion.SourceConsole).SetNote(n).SetText(in.Text).SetCreatedAt(at).Exec(ctx); err != nil {
		return Document{}, err
	}
	if err := tx.Commit(); err != nil {
		return Document{}, err
	}
	return s.Get(ctx, c, teamID, d.ID, 0)
}

// Get is a document the caller reads, with the text of version n, or of its
// current version when n is 0.
func (s *Service) Get(ctx context.Context, c Caller, teamID, documentID string, n int) (Document, error) {
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Document{}, err
	}
	if n == 0 {
		n = d.CurrentVersion
	}
	rows, err := s.DB.KnowledgeVersion.Query().Where(knowledgeversion.DocumentID(d.ID)).
		Order(ent.Desc(knowledgeversion.FieldNumber)).
		Select(knowledgeversion.FieldID, knowledgeversion.FieldNumber, knowledgeversion.FieldAuthorID, knowledgeversion.FieldSource, knowledgeversion.FieldComputer, knowledgeversion.FieldSessionID, knowledgeversion.FieldNote, knowledgeversion.FieldCreatedAt).
		All(ctx)
	if err != nil {
		return Document{}, err
	}
	authors := map[string]bool{}
	for _, r := range rows {
		authors[r.AuthorID] = true
	}
	people, err := s.people(ctx, authors)
	if err != nil {
		return Document{}, err
	}
	out := Document{DocumentSummary: summary(d), SpaceID: d.SpaceID, CanEdit: a.edit && !c.Agent, Version: n, Versions: make([]VersionView, 0, len(rows))}
	for _, r := range rows {
		out.Versions = append(out.Versions, VersionView{Number: r.Number, Author: people[r.AuthorID], Source: string(r.Source), Computer: r.Computer, SessionID: r.SessionID, Note: r.Note, CreatedAt: team.Time(r.CreatedAt)})
	}
	v, err := s.DB.KnowledgeVersion.Query().Where(knowledgeversion.DocumentID(d.ID), knowledgeversion.Number(n)).Only(ctx)
	if ent.IsNotFound(err) {
		return Document{}, notFound()
	}
	if err != nil {
		return Document{}, err
	}
	out.Text = v.Text
	if out.Attachments, err = s.attachments(ctx, d.ID); err != nil {
		return Document{}, err
	}
	tree, err := s.Tree(ctx, c, teamID)
	if err != nil {
		return Document{}, err
	}
	if out.Backlinks, err = s.backlinks(ctx, tree, d.ID, d.Title); err != nil {
		return Document{}, err
	}
	return out, nil
}

func (s *Service) people(ctx context.Context, ids map[string]bool) (map[string]Person, error) {
	list := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	out := map[string]Person{}
	for _, id := range list {
		out[id] = Person{ID: id}
	}
	users, err := s.DB.User.Query().Where(user.IDIn(list...)).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		out[u.ID] = Person{ID: u.ID, Name: u.Name, Email: u.Email}
	}
	return out, nil
}

// AddVersion saves a new text on top of in.BaseVersion; an editor's in the
// console. A base that is no longer current is knowledge_stale, and leaves
// the document as it was.
func (s *Service) AddVersion(ctx context.Context, c Caller, teamID, documentID string, in VersionInput) (Document, error) {
	if c.Agent {
		return Document{}, agentProposes()
	}
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Document{}, err
	}
	if !a.edit {
		return Document{}, notEditor()
	}
	n, err := note(in.Note)
	if err != nil {
		return Document{}, err
	}
	if err := text(in.Text); err != nil {
		return Document{}, err
	}
	if in.BaseVersion != d.CurrentVersion {
		return Document{}, stale()
	}
	if err := s.write(ctx, d.ID, in.BaseVersion, c.UserID, knowledgeversion.SourceConsole, origin{}, n, in.Text, nil); err != nil {
		return Document{}, err
	}
	return s.Get(ctx, c, teamID, d.ID, 0)
}

// write adds version base+1 by a conditional update of the document's
// current version, in one transaction with after (an acceptance's own
// update), so two writes on one base make exactly one version.
// origin is where a version came from: an agent's computer and session.
type origin struct{ computer, session string }

func (s *Service) write(ctx context.Context, documentID string, base int, author string, source knowledgeversion.Source, from origin, n, body string, after func(*ent.Tx) error) error {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	at := s.now()
	moved, err := tx.KnowledgeDocument.Update().Where(knowledgedocument.ID(documentID), knowledgedocument.CurrentVersion(base)).
		SetCurrentVersion(base + 1).SetUpdatedAt(at).Save(ctx)
	if err != nil {
		return err
	}
	if moved == 0 {
		return stale()
	}
	if err := tx.KnowledgeVersion.Create().SetDocumentID(documentID).SetNumber(base + 1).SetAuthorID(author).
		SetSource(source).SetComputer(from.computer).SetSessionID(from.session).SetNote(n).SetText(body).SetCreatedAt(at).Exec(ctx); err != nil {
		if ent.IsConstraintError(err) {
			return stale()
		}
		return err
	}
	if after != nil {
		if err := after(tx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Restore adds a version copying version n; an editor's.
func (s *Service) Restore(ctx context.Context, c Caller, teamID, documentID string, n int) (Document, error) {
	if c.Agent {
		return Document{}, agentProposes()
	}
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Document{}, err
	}
	if !a.edit {
		return Document{}, notEditor()
	}
	v, err := s.DB.KnowledgeVersion.Query().Where(knowledgeversion.DocumentID(d.ID), knowledgeversion.Number(n)).Only(ctx)
	if ent.IsNotFound(err) {
		return Document{}, notFound()
	}
	if err != nil {
		return Document{}, err
	}
	if err := s.write(ctx, d.ID, d.CurrentVersion, c.UserID, knowledgeversion.SourceConsole, origin{}, "Restored version "+itoa(n), v.Text, nil); err != nil {
		return Document{}, err
	}
	return s.Get(ctx, c, teamID, d.ID, 0)
}

// Patch renames a document or moves it to another folder of its space; an
// editor's.
func (s *Service) Patch(ctx context.Context, c Caller, teamID, documentID string, in DocumentPatch) (Document, error) {
	if c.Agent {
		return Document{}, agentProposes()
	}
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Document{}, err
	}
	if !a.edit {
		return Document{}, notEditor()
	}
	u := s.DB.KnowledgeDocument.UpdateOneID(d.ID)
	if in.Title != nil {
		title, err := name(*in.Title, 120, "title")
		if err != nil {
			return Document{}, err
		}
		u.SetTitle(title)
	}
	if in.FolderID != nil {
		if err := s.inFolder(ctx, d.SpaceID, *in.FolderID); err != nil {
			return Document{}, err
		}
		u.SetFolderID(*in.FolderID)
	}
	if err := u.Exec(ctx); ent.IsConstraintError(err) {
		return Document{}, taken()
	} else if err != nil {
		return Document{}, err
	}
	return s.Get(ctx, c, teamID, d.ID, 0)
}

// Delete deletes a document with its versions and proposals; an editor's.
func (s *Service) Delete(ctx context.Context, c Caller, teamID, documentID string) error {
	if c.Agent {
		return agentProposes()
	}
	d, a, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return err
	}
	if !a.edit {
		return notEditor()
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.KnowledgeVersion.Delete().Where(knowledgeversion.DocumentID(d.ID)).Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.KnowledgeProposal.Delete().Where(knowledgeproposal.DocumentID(d.ID)).Exec(ctx); err != nil {
		return err
	}
	digests, err := deleteAttachments(ctx, tx.Client(), []string{d.ID})
	if err != nil {
		return err
	}
	if err := tx.KnowledgeDocument.DeleteOneID(d.ID).Exec(ctx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.Forget(context.WithoutCancel(ctx), teamID, digests)
	return nil
}

// deleteAttachments removes the attachment rows of documents, in a caller's
// transaction, and returns the digests they named, whose objects the caller
// forgets once it commits.
func deleteAttachments(ctx context.Context, db *ent.Client, documentIDs []string) ([]string, error) {
	var digests []string
	if err := db.KnowledgeAttachment.Query().Where(knowledgeattachment.DocumentIDIn(documentIDs...)).
		Unique(true).Select(knowledgeattachment.FieldDigest).Scan(ctx, &digests); err != nil {
		return nil, err
	}
	if _, err := db.KnowledgeAttachment.Delete().Where(knowledgeattachment.DocumentIDIn(documentIDs...)).Exec(ctx); err != nil {
		return nil, err
	}
	return digests, nil
}
