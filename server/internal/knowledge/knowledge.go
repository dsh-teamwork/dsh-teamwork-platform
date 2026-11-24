// Package knowledge holds every rule about a team's knowledge
// (docs/tech/knowledge.md): spaces that carry access, folders and documents
// inside them, immutable versions of each document's Markdown, and proposals,
// the changes not yet in a document that an editor accepts or declines. An
// agent's change is always a proposal. internal/httpapi maps routes to it.
package knowledge

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgespace"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgespacemember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// MaxText is the most a document's text may hold (docs/tech/knowledge.md,
// "Architecture"), in bytes.
const MaxText = 1 << 20

// Service is knowledge's rules over the database.
type Service struct {
	DB   *ent.Client
	Team *team.Service
	Now  func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Caller is who asks: a member (UserID). TeamID, when set, is the one team a
// computer token reaches. Agent is true for a plugin or computer token, whose
// every change is a proposal.
type Caller struct {
	UserID string
	TeamID string
	Agent  bool
}

func notFound() error  { return wire.E(http.StatusNotFound, "knowledge_not_found") }
func notEditor() error { return wire.E(http.StatusForbidden, "knowledge_not_editor") }
func stale() error     { return wire.E(http.StatusConflict, "knowledge_stale") }
func taken() error     { return wire.E(http.StatusConflict, "knowledge_name_taken") }
func tooLarge() error  { return wire.E(http.StatusRequestEntityTooLarge, "knowledge_too_large") }
func agentProposes() error {
	return wire.E(http.StatusForbidden, "knowledge_agent_proposes")
}

func invalid(message string, at ...any) error {
	var is wire.Issues
	is.Add(message, at...)
	return is.Err()
}

// name checks a space's, a folder's or a document's name: trimmed, non-empty,
// at most max characters, and no slash or control character, since it is a
// path segment in the plugin's copy.
func name(v string, max int, field string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" || utf8.RuneCountInString(v) > max || strings.ContainsAny(v, "/\\") || v == "." || v == ".." {
		return "", invalid("A name of 1 to "+itoa(max)+" characters with no slash", field)
	}
	for _, r := range v {
		if r < 0x20 || r == 0x7f {
			return "", invalid("A name with no control character", field)
		}
	}
	return v, nil
}

func note(v string) (string, error) {
	v = strings.TrimSpace(v)
	if utf8.RuneCountInString(v) > 200 {
		return "", invalid("At most 200 characters", "note")
	}
	return v, nil
}

func text(v string) error {
	if len(v) > MaxText {
		return tooLarge()
	}
	if !utf8.ValidString(v) {
		return invalid("UTF-8 Markdown", "text")
	}
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for ; n > 0; n /= 10 {
		b = append([]byte{byte('0' + n%10)}, b...)
	}
	return string(b)
}

// access is how a member stands to one space.
type access struct {
	m     *ent.Membership
	read  bool
	edit  bool
	admin bool
	space *ent.KnowledgeSpace
}

// member re-reads the caller's membership of teamID: a team they are not in
// is a 404, as for every team route, and a token for one team reaches no
// other.
func (s *Service) member(ctx context.Context, c Caller, teamID string) (*ent.Membership, error) {
	if c.TeamID != "" && c.TeamID != teamID {
		return nil, wire.E(http.StatusNotFound, wire.TeamNotFound)
	}
	return s.Team.RequireMembership(ctx, c.UserID, teamID, false)
}

// standing is how m stands to sp: the team's admins and its creator edit
// every space; a member the space names as an editor edits it; everyone
// reads a space whose reading is "team", and only those it names one whose
// reading is "members".
func (s *Service) standing(ctx context.Context, m *ent.Membership, sp *ent.KnowledgeSpace) (access, error) {
	a := access{m: m, space: sp, admin: m.Role == membership.RoleAdmin}
	if a.admin || sp.CreatedBy == m.UserID {
		a.read, a.edit = true, true
		return a, nil
	}
	row, err := s.DB.KnowledgeSpaceMember.Query().Where(knowledgespacemember.SpaceID(sp.ID), knowledgespacemember.UserID(m.UserID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return a, err
	}
	if row != nil && row.Role == knowledgespacemember.RoleEditor {
		a.read, a.edit = true, true
		return a, nil
	}
	a.read = sp.Reading == knowledgespace.ReadingTeam || row != nil
	return a, nil
}

// space is a space of teamID and how the caller stands to it. One the caller
// may not read is knowledge_not_found, so its existence is not told.
func (s *Service) space(ctx context.Context, c Caller, teamID, spaceID string) (access, error) {
	m, err := s.member(ctx, c, teamID)
	if err != nil {
		return access{}, err
	}
	sp, err := s.DB.KnowledgeSpace.Query().Where(knowledgespace.ID(spaceID), knowledgespace.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return access{}, notFound()
	}
	if err != nil {
		return access{}, err
	}
	a, err := s.standing(ctx, m, sp)
	if err != nil {
		return access{}, err
	}
	if !a.read {
		return access{}, notFound()
	}
	return a, nil
}

// editing is space for a change only an editor makes. An agent never edits:
// its change is a proposal.
func (s *Service) editing(ctx context.Context, c Caller, teamID, spaceID string) (access, error) {
	if c.Agent {
		return access{}, agentProposes()
	}
	a, err := s.space(ctx, c, teamID, spaceID)
	if err != nil {
		return access{}, err
	}
	if !a.edit {
		return access{}, notEditor()
	}
	return a, nil
}
