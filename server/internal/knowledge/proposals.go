package knowledge

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeproposal"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgespace"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// ProposalInput is a change to a document on top of BaseVersion. Computer and
// SessionID say where an agent's came from.
type ProposalInput struct {
	BaseVersion int    `json:"baseVersion"`
	Text        string `json:"text"`
	Note        string `json:"note"`
	Computer    string `json:"computer"`
	SessionID   string `json:"sessionId"`
}

// Proposal is a proposal as a list shows it. Stale is worked out: its base is
// no longer the document's current version.
type Proposal struct {
	ID            string  `json:"id"`
	DocumentID    string  `json:"documentId"`
	DocumentTitle string  `json:"documentTitle"`
	SpaceID       string  `json:"spaceId"`
	BaseVersion   int     `json:"baseVersion"`
	Author        Person  `json:"author"`
	Source        string  `json:"source"`
	Computer      string  `json:"computer"`
	SessionID     string  `json:"sessionId"`
	Note          string  `json:"note"`
	State         string  `json:"state"`
	Stale         bool    `json:"stale"`
	CanDecide     bool    `json:"canDecide"`
	Reason        string  `json:"reason"`
	Version       int     `json:"version"`
	CreatedAt     string  `json:"createdAt"`
	DecidedAt     *string `json:"decidedAt"`
}

// ProposalDetail is one proposal with its text and the text it started from,
// for the difference an editor reads.
type ProposalDetail struct {
	Proposal
	Text     string `json:"text"`
	BaseText string `json:"baseText"`
}

// ProposalList is the proposals one member sees.
type ProposalList struct {
	Proposals []Proposal `json:"proposals"`
}

// Propose records a change to a document the caller reads, on top of its
// current version. A plugin's or computer's change is an agent's; the
// console's is a reader's.
func (s *Service) Propose(ctx context.Context, c Caller, teamID, documentID string, in ProposalInput) (ProposalDetail, error) {
	d, _, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return ProposalDetail{}, err
	}
	n, err := note(in.Note)
	if err != nil {
		return ProposalDetail{}, err
	}
	if err := text(in.Text); err != nil {
		return ProposalDetail{}, err
	}
	in.Computer, in.SessionID = strings.TrimSpace(in.Computer), strings.TrimSpace(in.SessionID)
	if utf8.RuneCountInString(in.Computer) > 64 || len(in.SessionID) > 128 {
		return ProposalDetail{}, invalid("A computer name of at most 64 characters and a session id of at most 128", "computer")
	}
	if in.BaseVersion != d.CurrentVersion {
		return ProposalDetail{}, stale()
	}
	source := knowledgeproposal.SourceConsole
	if c.Agent {
		source = knowledgeproposal.SourceAgent
	}
	p, err := s.DB.KnowledgeProposal.Create().SetTeamID(teamID).SetDocumentID(d.ID).SetBaseVersion(in.BaseVersion).
		SetAuthorID(c.UserID).SetSource(source).SetComputer(in.Computer).SetSessionID(in.SessionID).
		SetNote(n).SetText(in.Text).Save(ctx)
	if err != nil {
		return ProposalDetail{}, err
	}
	return s.GetProposal(ctx, c, teamID, p.ID)
}

// Proposals is what the caller sees of teamID's proposals: those to the
// spaces they edit, and their own, newest first; state filters them.
func (s *Service) Proposals(ctx context.Context, c Caller, teamID, state string) (ProposalList, error) {
	m, err := s.member(ctx, c, teamID)
	if err != nil {
		return ProposalList{}, err
	}
	q := s.DB.KnowledgeProposal.Query().Where(knowledgeproposal.TeamID(teamID)).Order(ent.Desc(knowledgeproposal.FieldCreatedAt)).Limit(200)
	if state != "" {
		if knowledgeproposal.StateValidator(knowledgeproposal.State(state)) != nil {
			return ProposalList{}, invalid("pending, accepted, declined or withdrawn", "state")
		}
		q = q.Where(knowledgeproposal.StateEQ(knowledgeproposal.State(state)))
	}
	rows, err := q.All(ctx)
	if err != nil {
		return ProposalList{}, err
	}
	out := ProposalList{Proposals: []Proposal{}}
	edits := map[string]bool{}
	for _, p := range rows {
		d, err := s.DB.KnowledgeDocument.Get(ctx, p.DocumentID)
		if err != nil {
			return ProposalList{}, err
		}
		edit, seen := edits[d.SpaceID]
		if !seen {
			sp, err := s.DB.KnowledgeSpace.Query().Where(knowledgespace.ID(d.SpaceID)).Only(ctx)
			if err != nil {
				return ProposalList{}, err
			}
			a, err := s.standing(ctx, m, sp)
			if err != nil {
				return ProposalList{}, err
			}
			edit = a.edit
			edits[d.SpaceID] = edit
		}
		if !edit && p.AuthorID != c.UserID {
			continue
		}
		view, err := s.view(ctx, p, d, edit && !c.Agent)
		if err != nil {
			return ProposalList{}, err
		}
		out.Proposals = append(out.Proposals, view)
	}
	return out, nil
}

func (s *Service) view(ctx context.Context, p *ent.KnowledgeProposal, d *ent.KnowledgeDocument, canDecide bool) (Proposal, error) {
	people, err := s.people(ctx, map[string]bool{p.AuthorID: true})
	if err != nil {
		return Proposal{}, err
	}
	v := Proposal{ID: p.ID, DocumentID: d.ID, DocumentTitle: d.Title, SpaceID: d.SpaceID, BaseVersion: p.BaseVersion,
		Author: people[p.AuthorID], Source: string(p.Source), Computer: p.Computer, SessionID: p.SessionID, Note: p.Note,
		State: string(p.State), Stale: p.State == knowledgeproposal.StatePending && p.BaseVersion != d.CurrentVersion,
		CanDecide: canDecide && p.State == knowledgeproposal.StatePending, Reason: p.Reason, Version: p.Version, CreatedAt: team.Time(p.CreatedAt)}
	if p.DecidedAt != nil {
		t := team.Time(*p.DecidedAt)
		v.DecidedAt = &t
	}
	return v, nil
}

// proposal is a proposal of teamID the caller may see: their own, or one to
// a space they edit.
func (s *Service) proposal(ctx context.Context, c Caller, teamID, proposalID string) (*ent.KnowledgeProposal, *ent.KnowledgeDocument, access, error) {
	p, err := s.DB.KnowledgeProposal.Query().Where(knowledgeproposal.ID(proposalID), knowledgeproposal.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		if _, err := s.member(ctx, c, teamID); err != nil {
			return nil, nil, access{}, err
		}
		return nil, nil, access{}, notFound()
	}
	if err != nil {
		return nil, nil, access{}, err
	}
	d, a, err := s.document(ctx, c, teamID, p.DocumentID)
	if err != nil {
		return nil, nil, access{}, err
	}
	if !a.edit && p.AuthorID != c.UserID {
		return nil, nil, access{}, notFound()
	}
	return p, d, a, nil
}

// GetProposal is one proposal with its text and its base's.
func (s *Service) GetProposal(ctx context.Context, c Caller, teamID, proposalID string) (ProposalDetail, error) {
	p, d, a, err := s.proposal(ctx, c, teamID, proposalID)
	if err != nil {
		return ProposalDetail{}, err
	}
	base, err := s.DB.KnowledgeVersion.Query().Where(knowledgeversion.DocumentID(d.ID), knowledgeversion.Number(p.BaseVersion)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return ProposalDetail{}, err
	}
	v, err := s.view(ctx, p, d, a.edit && !c.Agent)
	if err != nil {
		return ProposalDetail{}, err
	}
	out := ProposalDetail{Proposal: v, Text: p.Text}
	if base != nil {
		out.BaseText = base.Text
	}
	return out, nil
}

// Decision is an editor's accept or decline; a decline gives a reason.
type Decision struct {
	Reason string `json:"reason"`
}

// Accept makes a pending proposal the document's next version, under its
// author's name; an editor's in the console. A proposal on a version that
// is no longer current is knowledge_stale and stays pending.
func (s *Service) Accept(ctx context.Context, c Caller, teamID, proposalID string) (ProposalDetail, error) {
	p, d, _, err := s.decidable(ctx, c, teamID, proposalID)
	if err != nil {
		return ProposalDetail{}, err
	}
	if p.BaseVersion != d.CurrentVersion {
		return ProposalDetail{}, stale()
	}
	source := knowledgeversion.SourceConsole
	if p.Source == knowledgeproposal.SourceAgent {
		source = knowledgeversion.SourceAgent
	}
	err = s.write(ctx, d.ID, p.BaseVersion, p.AuthorID, source, origin{p.Computer, p.SessionID}, p.Note, p.Text, func(tx *ent.Tx) error {
		n, err := tx.KnowledgeProposal.Update().Where(knowledgeproposal.ID(p.ID), knowledgeproposal.StateEQ(knowledgeproposal.StatePending)).
			SetState(knowledgeproposal.StateAccepted).SetDecidedBy(c.UserID).SetDecidedAt(s.now()).SetVersion(p.BaseVersion + 1).Save(ctx)
		if err == nil && n == 0 {
			return wire.E(http.StatusConflict, "knowledge_proposal_decided")
		}
		return err
	})
	if err != nil {
		return ProposalDetail{}, err
	}
	return s.GetProposal(ctx, c, teamID, p.ID)
}

// Decline closes a pending proposal with a reason; an editor's.
func (s *Service) Decline(ctx context.Context, c Caller, teamID, proposalID string, in Decision) (ProposalDetail, error) {
	p, _, _, err := s.decidable(ctx, c, teamID, proposalID)
	if err != nil {
		return ProposalDetail{}, err
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > 500 {
		return ProposalDetail{}, invalid("A reason of 1 to 500 characters", "reason")
	}
	if err := s.close(ctx, p.ID, knowledgeproposal.StateDeclined, c.UserID, reason); err != nil {
		return ProposalDetail{}, err
	}
	return s.GetProposal(ctx, c, teamID, p.ID)
}

// Withdraw closes the caller's own pending proposal.
func (s *Service) Withdraw(ctx context.Context, c Caller, teamID, proposalID string) (ProposalDetail, error) {
	p, _, _, err := s.proposal(ctx, c, teamID, proposalID)
	if err != nil {
		return ProposalDetail{}, err
	}
	if p.AuthorID != c.UserID {
		return ProposalDetail{}, wire.E(http.StatusForbidden, "knowledge_not_author")
	}
	if err := s.close(ctx, p.ID, knowledgeproposal.StateWithdrawn, c.UserID, ""); err != nil {
		return ProposalDetail{}, err
	}
	return s.GetProposal(ctx, c, teamID, p.ID)
}

func (s *Service) decidable(ctx context.Context, c Caller, teamID, proposalID string) (*ent.KnowledgeProposal, *ent.KnowledgeDocument, access, error) {
	if c.Agent {
		return nil, nil, access{}, agentProposes()
	}
	p, d, a, err := s.proposal(ctx, c, teamID, proposalID)
	if err != nil {
		return nil, nil, access{}, err
	}
	if !a.edit {
		return nil, nil, access{}, notEditor()
	}
	if p.State != knowledgeproposal.StatePending {
		return nil, nil, access{}, wire.E(http.StatusConflict, "knowledge_proposal_decided")
	}
	return p, d, a, nil
}

// close moves a pending proposal to state once, by a conditional update.
func (s *Service) close(ctx context.Context, id string, state knowledgeproposal.State, by, reason string) error {
	n, err := s.DB.KnowledgeProposal.Update().Where(knowledgeproposal.ID(id), knowledgeproposal.StateEQ(knowledgeproposal.StatePending)).
		SetState(state).SetDecidedBy(by).SetDecidedAt(s.now()).SetReason(reason).Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return wire.E(http.StatusConflict, "knowledge_proposal_decided")
	}
	return nil
}
