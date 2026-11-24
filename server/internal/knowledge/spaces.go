package knowledge

import (
	"context"
	"net/http"
	"sort"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgedocument"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgefolder"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeproposal"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgespace"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgespacemember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// FolderView is a folder as the tree shows it.
type FolderView struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	Name     string `json:"name"`
}

// DocumentSummary is a document as the tree shows it.
type DocumentSummary struct {
	ID             string `json:"id"`
	FolderID       string `json:"folderId"`
	Title          string `json:"title"`
	CurrentVersion int    `json:"currentVersion"`
	UpdatedAt      string `json:"updatedAt"`
}

// SpaceView is a space the caller reads, with what is in it.
type SpaceView struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Reading   string            `json:"reading"`
	CanEdit   bool              `json:"canEdit"`
	Folders   []FolderView      `json:"folders"`
	Documents []DocumentSummary `json:"documents"`
}

// Tree is a team's knowledge as one member may read it.
type Tree struct {
	CanCreateSpace bool        `json:"canCreateSpace"`
	Spaces         []SpaceView `json:"spaces"`
}

// Tree is every space of teamID the caller reads, with its folders and
// documents, by name.
func (s *Service) Tree(ctx context.Context, c Caller, teamID string) (Tree, error) {
	m, err := s.member(ctx, c, teamID)
	if err != nil {
		return Tree{}, err
	}
	spaces, err := s.DB.KnowledgeSpace.Query().Where(knowledgespace.TeamID(teamID)).Order(ent.Asc(knowledgespace.FieldName)).All(ctx)
	if err != nil {
		return Tree{}, err
	}
	out := Tree{CanCreateSpace: m.Role == membership.RoleAdmin && !c.Agent, Spaces: []SpaceView{}}
	for _, sp := range spaces {
		a, err := s.standing(ctx, m, sp)
		if err != nil {
			return Tree{}, err
		}
		if !a.read {
			continue
		}
		v, err := s.spaceView(ctx, a, c.Agent)
		if err != nil {
			return Tree{}, err
		}
		out.Spaces = append(out.Spaces, v)
	}
	return out, nil
}

func (s *Service) spaceView(ctx context.Context, a access, agent bool) (SpaceView, error) {
	v := SpaceView{ID: a.space.ID, Name: a.space.Name, Reading: string(a.space.Reading), CanEdit: a.edit && !agent, Folders: []FolderView{}, Documents: []DocumentSummary{}}
	folders, err := s.DB.KnowledgeFolder.Query().Where(knowledgefolder.SpaceID(a.space.ID)).Order(ent.Asc(knowledgefolder.FieldName)).All(ctx)
	if err != nil {
		return v, err
	}
	for _, f := range folders {
		v.Folders = append(v.Folders, FolderView{ID: f.ID, ParentID: f.ParentID, Name: f.Name})
	}
	docs, err := s.DB.KnowledgeDocument.Query().Where(knowledgedocument.SpaceID(a.space.ID)).Order(ent.Asc(knowledgedocument.FieldTitle)).All(ctx)
	if err != nil {
		return v, err
	}
	for _, d := range docs {
		v.Documents = append(v.Documents, summary(d))
	}
	return v, nil
}

func summary(d *ent.KnowledgeDocument) DocumentSummary {
	return DocumentSummary{ID: d.ID, FolderID: d.FolderID, Title: d.Title, CurrentVersion: d.CurrentVersion, UpdatedAt: team.Time(d.UpdatedAt)}
}

// CreateSpace makes a space of teamID, read by the whole team. Only the
// team's admin creates one.
func (s *Service) CreateSpace(ctx context.Context, c Caller, teamID, spaceName string) (SpaceView, error) {
	if c.Agent {
		return SpaceView{}, agentProposes()
	}
	m, err := s.member(ctx, c, teamID)
	if err != nil {
		return SpaceView{}, err
	}
	if m.Role != membership.RoleAdmin {
		return SpaceView{}, wire.E(http.StatusForbidden, wire.AdminRequired)
	}
	n, err := name(spaceName, 80, "name")
	if err != nil {
		return SpaceView{}, err
	}
	sp, err := s.DB.KnowledgeSpace.Create().SetTeamID(teamID).SetName(n).SetCreatedBy(c.UserID).Save(ctx)
	if ent.IsConstraintError(err) {
		return SpaceView{}, taken()
	}
	if err != nil {
		return SpaceView{}, err
	}
	return SpaceView{ID: sp.ID, Name: sp.Name, Reading: string(sp.Reading), CanEdit: true, Folders: []FolderView{}, Documents: []DocumentSummary{}}, nil
}

// RenameSpace renames a space; an editor's.
func (s *Service) RenameSpace(ctx context.Context, c Caller, teamID, spaceID, spaceName string) error {
	if _, err := s.editing(ctx, c, teamID, spaceID); err != nil {
		return err
	}
	n, err := name(spaceName, 80, "name")
	if err != nil {
		return err
	}
	err = s.DB.KnowledgeSpace.UpdateOneID(spaceID).SetName(n).Exec(ctx)
	if ent.IsConstraintError(err) {
		return taken()
	}
	return err
}

// DeleteSpace deletes a space with every folder, document, version and
// proposal in it; an editor's.
func (s *Service) DeleteSpace(ctx context.Context, c Caller, teamID, spaceID string) error {
	if _, err := s.editing(ctx, c, teamID, spaceID); err != nil {
		return err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	digests, err := deleteSpace(ctx, tx.Client(), spaceID)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.Forget(context.WithoutCancel(ctx), teamID, digests)
	return nil
}

// deleteSpace removes a space and everything in it, in a caller's
// transaction, and returns the digests its attachments named.
func deleteSpace(ctx context.Context, db *ent.Client, spaceID string) ([]string, error) {
	docs, err := db.KnowledgeDocument.Query().Where(knowledgedocument.SpaceID(spaceID)).IDs(ctx)
	if err != nil {
		return nil, err
	}
	var digests []string
	if len(docs) > 0 {
		if digests, err = deleteAttachments(ctx, db, docs); err != nil {
			return nil, err
		}
		if _, err := db.KnowledgeVersion.Delete().Where(knowledgeversion.DocumentIDIn(docs...)).Exec(ctx); err != nil {
			return nil, err
		}
		if _, err := db.KnowledgeProposal.Delete().Where(knowledgeproposal.DocumentIDIn(docs...)).Exec(ctx); err != nil {
			return nil, err
		}
		if _, err := db.KnowledgeDocument.Delete().Where(knowledgedocument.IDIn(docs...)).Exec(ctx); err != nil {
			return nil, err
		}
	}
	if _, err := db.KnowledgeFolder.Delete().Where(knowledgefolder.SpaceID(spaceID)).Exec(ctx); err != nil {
		return nil, err
	}
	if _, err := db.KnowledgeSpaceMember.Delete().Where(knowledgespacemember.SpaceID(spaceID)).Exec(ctx); err != nil {
		return nil, err
	}
	_, err = db.KnowledgeSpace.Delete().Where(knowledgespace.ID(spaceID)).Exec(ctx)
	return digests, err
}

// Access is who reads and who edits a space, besides the team's admins and
// the space's creator, who always edit it.
type Access struct {
	Reading string   `json:"reading"`
	Readers []string `json:"readers"`
	Editors []string `json:"editors"`
}

// Validate holds an access change to its shape.
func (a *Access) Validate() error {
	var is wire.Issues
	if a.Reading != "team" && a.Reading != "members" {
		is.Add("team or members", "reading")
	}
	if a.Readers == nil {
		a.Readers = []string{}
	}
	if a.Editors == nil {
		a.Editors = []string{}
	}
	if len(a.Readers)+len(a.Editors) > 500 {
		is.Add("At most 500 members", "readers")
	}
	return is.Err()
}

// GetAccess is a space's access; an editor's to see.
func (s *Service) GetAccess(ctx context.Context, c Caller, teamID, spaceID string) (Access, error) {
	a, err := s.editing(ctx, c, teamID, spaceID)
	if err != nil {
		return Access{}, err
	}
	rows, err := s.DB.KnowledgeSpaceMember.Query().Where(knowledgespacemember.SpaceID(spaceID)).All(ctx)
	if err != nil {
		return Access{}, err
	}
	in, err := s.DB.Membership.Query().Where(membership.TeamID(a.space.TeamID)).Select(membership.FieldUserID).Strings(ctx)
	if err != nil {
		return Access{}, err
	}
	current := map[string]bool{}
	for _, u := range in {
		current[u] = true
	}
	out := Access{Reading: string(a.space.Reading), Readers: []string{}, Editors: []string{}}
	for _, r := range rows {
		if !current[r.UserID] {
			continue // a member who left the team keeps no place in it
		}
		if r.Role == knowledgespacemember.RoleEditor {
			out.Editors = append(out.Editors, r.UserID)
		} else {
			out.Readers = append(out.Readers, r.UserID)
		}
	}
	sort.Strings(out.Readers)
	sort.Strings(out.Editors)
	return out, nil
}

// SetAccess replaces a space's access at once; an editor's. Every member it
// names must be in the team; readers are kept only while reading is
// "members", and a member named both ways is an editor.
func (s *Service) SetAccess(ctx context.Context, c Caller, teamID, spaceID string, in Access) (Access, error) {
	if _, err := s.editing(ctx, c, teamID, spaceID); err != nil {
		return Access{}, err
	}
	roles := map[string]knowledgespacemember.Role{}
	if in.Reading == "members" {
		for _, u := range in.Readers {
			roles[u] = knowledgespacemember.RoleReader
		}
	}
	for _, u := range in.Editors {
		roles[u] = knowledgespacemember.RoleEditor
	}
	if len(roles) > 0 {
		ids := make([]string, 0, len(roles))
		for u := range roles {
			ids = append(ids, u)
		}
		n, err := s.DB.Membership.Query().Where(membership.TeamID(teamID), membership.UserIDIn(ids...)).Count(ctx)
		if err != nil {
			return Access{}, err
		}
		if n != len(ids) {
			return Access{}, wire.E(http.StatusBadRequest, "knowledge_member_not_in_team")
		}
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return Access{}, err
	}
	defer tx.Rollback()
	if err := tx.KnowledgeSpace.UpdateOneID(spaceID).SetReading(knowledgespace.Reading(in.Reading)).Exec(ctx); err != nil {
		return Access{}, err
	}
	if _, err := tx.KnowledgeSpaceMember.Delete().Where(knowledgespacemember.SpaceID(spaceID)).Exec(ctx); err != nil {
		return Access{}, err
	}
	for u, role := range roles {
		if err := tx.KnowledgeSpaceMember.Create().SetSpaceID(spaceID).SetUserID(u).SetRole(role).Exec(ctx); err != nil {
			return Access{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Access{}, err
	}
	return s.GetAccess(ctx, c, teamID, spaceID)
}

// FolderInput makes or renames a folder.
type FolderInput struct {
	SpaceID  string `json:"spaceId"`
	ParentID string `json:"parentId"`
	Name     string `json:"name"`
}

// CreateFolder makes a folder in a space, at its root or in parentID; an
// editor's.
func (s *Service) CreateFolder(ctx context.Context, c Caller, teamID string, in FolderInput) (FolderView, error) {
	if _, err := s.editing(ctx, c, teamID, in.SpaceID); err != nil {
		return FolderView{}, err
	}
	n, err := name(in.Name, 80, "name")
	if err != nil {
		return FolderView{}, err
	}
	if in.ParentID != "" {
		if ok, err := s.DB.KnowledgeFolder.Query().Where(knowledgefolder.ID(in.ParentID), knowledgefolder.SpaceID(in.SpaceID)).Exist(ctx); err != nil || !ok {
			if err != nil {
				return FolderView{}, err
			}
			return FolderView{}, notFound()
		}
	}
	f, err := s.DB.KnowledgeFolder.Create().SetSpaceID(in.SpaceID).SetParentID(in.ParentID).SetName(n).Save(ctx)
	if ent.IsConstraintError(err) {
		return FolderView{}, taken()
	}
	if err != nil {
		return FolderView{}, err
	}
	return FolderView{ID: f.ID, ParentID: f.ParentID, Name: f.Name}, nil
}

// folder is a folder of teamID and the caller's standing to its space.
func (s *Service) folder(ctx context.Context, c Caller, teamID, folderID string) (*ent.KnowledgeFolder, error) {
	f, err := s.DB.KnowledgeFolder.Get(ctx, folderID)
	if ent.IsNotFound(err) {
		return nil, notFound()
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.editing(ctx, c, teamID, f.SpaceID); err != nil {
		return nil, err
	}
	return f, nil
}

// RenameFolder renames a folder; an editor's.
func (s *Service) RenameFolder(ctx context.Context, c Caller, teamID, folderID, folderName string) error {
	if _, err := s.folder(ctx, c, teamID, folderID); err != nil {
		return err
	}
	n, err := name(folderName, 80, "name")
	if err != nil {
		return err
	}
	err = s.DB.KnowledgeFolder.UpdateOneID(folderID).SetName(n).Exec(ctx)
	if ent.IsConstraintError(err) {
		return taken()
	}
	return err
}

// DeleteFolder deletes an empty folder; an editor's. One that still holds a
// folder or a document is knowledge_folder_not_empty.
func (s *Service) DeleteFolder(ctx context.Context, c Caller, teamID, folderID string) error {
	if _, err := s.folder(ctx, c, teamID, folderID); err != nil {
		return err
	}
	inside, err := s.DB.KnowledgeFolder.Query().Where(knowledgefolder.ParentID(folderID)).Exist(ctx)
	if err == nil && !inside {
		inside, err = s.DB.KnowledgeDocument.Query().Where(knowledgedocument.FolderID(folderID)).Exist(ctx)
	}
	if err != nil {
		return err
	}
	if inside {
		return wire.E(http.StatusConflict, "knowledge_folder_not_empty")
	}
	return s.DB.KnowledgeFolder.DeleteOneID(folderID).Exec(ctx)
}
