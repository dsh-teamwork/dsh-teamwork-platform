package knowledge

import (
	"context"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeattachment"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
)

// SyncedDocument is a document as the plugin's copy names it: the folders
// above it in its space, its title, and the version the copy should hold.
type SyncedDocument struct {
	ID          string             `json:"id"`
	Folders     []string           `json:"folders"`
	Title       string             `json:"title"`
	Version     int                `json:"version"`
	Attachments []SyncedAttachment `json:"attachments"`
}

// SyncedAttachment is an attachment the copy keeps beside its document, under
// {title}.files/; its digest says whether the copy already holds its bytes.
type SyncedAttachment struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
}

// SyncedSpace is a space the member reads.
type SyncedSpace struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Documents []SyncedDocument `json:"documents"`
}

// SyncedTeam is one team's knowledge for the plugin's copy.
type SyncedTeam struct {
	TeamID   string        `json:"teamId"`
	TeamName string        `json:"teamName"`
	Spaces   []SyncedSpace `json:"spaces"`
}

// Manifest is what the plugin keeps a read-only copy of: every document the
// member reads, in every team it reaches (docs/tech/knowledge.md, "The sync
// manifest"). The plugin fetches only the versions it lacks and deletes what
// is no longer listed.
type Manifest struct {
	Teams []SyncedTeam `json:"teams"`
}

// Manifest lists the knowledge the caller reads, in each of their teams, or
// in the one team a computer token reaches.
func (s *Service) Manifest(ctx context.Context, c Caller) (Manifest, error) {
	q := s.DB.Membership.Query().Where(membership.UserID(c.UserID))
	if c.TeamID != "" {
		q = q.Where(membership.TeamID(c.TeamID))
	}
	ms, err := q.All(ctx)
	if err != nil {
		return Manifest{}, err
	}
	out := Manifest{Teams: []SyncedTeam{}}
	for _, m := range ms {
		t, err := s.DB.Team.Query().Where(team.ID(m.TeamID)).Only(ctx)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return Manifest{}, err
		}
		tree, err := s.Tree(ctx, c, m.TeamID)
		if err != nil {
			return Manifest{}, err
		}
		files, err := s.DB.KnowledgeAttachment.Query().Where(knowledgeattachment.TeamID(m.TeamID)).
			Order(ent.Asc(knowledgeattachment.FieldName)).All(ctx)
		if err != nil {
			return Manifest{}, err
		}
		byDocument := map[string][]SyncedAttachment{}
		for _, f := range files {
			byDocument[f.DocumentID] = append(byDocument[f.DocumentID], SyncedAttachment{Name: f.Name, Size: f.Size, Digest: f.Digest})
		}
		st := SyncedTeam{TeamID: t.ID, TeamName: t.Name, Spaces: []SyncedSpace{}}
		for _, sp := range tree.Spaces {
			byID := map[string]FolderView{}
			for _, f := range sp.Folders {
				byID[f.ID] = f
			}
			ss := SyncedSpace{ID: sp.ID, Name: sp.Name, Documents: []SyncedDocument{}}
			for _, d := range sp.Documents {
				attached := byDocument[d.ID]
				if attached == nil {
					attached = []SyncedAttachment{}
				}
				ss.Documents = append(ss.Documents, SyncedDocument{ID: d.ID, Folders: folders(byID, d.FolderID), Title: d.Title, Version: d.CurrentVersion, Attachments: attached})
			}
			st.Spaces = append(st.Spaces, ss)
		}
		out.Teams = append(out.Teams, st)
	}
	return out, nil
}

// folders is the names of the folders from a space's root down to id. A
// parent missing from the tree, which a folder deleted mid-request could
// leave, ends the walk.
func folders(byID map[string]FolderView, id string) []string {
	out := []string{}
	for seen := 0; id != "" && seen < 64; seen++ {
		f, ok := byID[id]
		if !ok {
			break
		}
		out = append([]string{f.Name}, out...)
		id = f.ParentID
	}
	return out
}
