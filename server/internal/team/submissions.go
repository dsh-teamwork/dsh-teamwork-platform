package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourcesubmission"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type SubmissionView struct {
	ID          string          `json:"id"`
	ConfigID    string          `json:"configId"`
	BaseVersion int             `json:"baseVersion"`
	Proposal    json.RawMessage `json:"proposal"`
	Note        string          `json:"note"`
	AuthorID    string          `json:"authorId"`
	State       string          `json:"state"`
	Revision    int             `json:"revision"`
	ReviewerID  string          `json:"reviewerId"`
	Reason      string          `json:"reason"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
	DecidedAt   *string         `json:"decidedAt"`
}

func submissionView(r *ent.ResourceSubmission) SubmissionView {
	var decided *string
	if r.DecidedAt != nil {
		v := Time(*r.DecidedAt)
		decided = &v
	}
	return SubmissionView{r.ID, r.ConfigID, r.BaseVersion, r.Proposal, r.Note, r.AuthorID, string(r.State), r.Revision, r.ReviewerID, r.Reason, Time(r.CreatedAt), Time(r.UpdatedAt), decided}
}
func (s *Service) Submission(ctx context.Context, userID, teamID, id string) (*ent.ResourceSubmission, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	q := s.DB.ResourceSubmission.Query().Where(resourcesubmission.ID(id), resourcesubmission.TeamID(teamID))
	if m.Role != membership.RoleAdmin {
		q.Where(resourcesubmission.AuthorID(userID))
	}
	r, err := q.Only(ctx)
	if ent.IsNotFound(err) {
		return nil, wire.E(http.StatusNotFound, "submission_not_found")
	}
	return r, err
}

// ListSubmissions pages the submissions the caller may see, newest first: the
// team's for an admin, their own for a member or for an admin who asks for
// theirs (mine); `state`, when given, keeps one.
func (s *Service) ListSubmissions(ctx context.Context, userID, teamID string, offset int, state string, mine bool) ([]SubmissionView, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	q := s.DB.ResourceSubmission.Query().Where(resourcesubmission.TeamID(teamID))
	if mine || m.Role != membership.RoleAdmin {
		q.Where(resourcesubmission.AuthorID(userID))
	}
	if state != "" {
		if resourcesubmission.StateValidator(resourcesubmission.State(state)) != nil {
			return nil, wire.E(http.StatusBadRequest, "invalid_request")
		}
		q.Where(resourcesubmission.StateEQ(resourcesubmission.State(state)))
	}
	rows, err := q.Order(ent.Desc(resourcesubmission.FieldCreatedAt), ent.Desc(resourcesubmission.FieldID)).Offset(offset).Limit(50).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]SubmissionView, 0, len(rows))
	for _, r := range rows {
		out = append(out, submissionView(r))
	}
	return out, nil
}

// SubmissionDetail applies the same author/admin visibility as listing.
func (s *Service) SubmissionDetail(ctx context.Context, userID, teamID, id string) (SubmissionView, error) {
	r, err := s.Submission(ctx, userID, teamID, id)
	if err != nil {
		return SubmissionView{}, err
	}
	return submissionView(r), nil
}
