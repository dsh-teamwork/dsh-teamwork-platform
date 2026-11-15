package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourcesubmission"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
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
func proposal(in wire.ConfigInput) json.RawMessage {
	b, _ := json.Marshal(struct {
		Kind string          `json:"kind"`
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}{in.Kind, in.Name, in.Canonical()})
	return b
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
func (s *Service) ListSubmissions(ctx context.Context, userID, teamID string, offset int) ([]SubmissionView, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	q := s.DB.ResourceSubmission.Query().Where(resourcesubmission.TeamID(teamID))
	if m.Role != membership.RoleAdmin {
		q.Where(resourcesubmission.AuthorID(userID))
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
func (s *Service) SaveSubmission(ctx context.Context, userID, teamID, id string, in wire.SubmissionInput) (SubmissionView, error) {
	if err := in.Validate(); err != nil {
		return SubmissionView{}, err
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return SubmissionView{}, err
	}
	defer tx.Rollback()
	local := *s
	local.DB = tx.Client()
	if _, err := local.RequireMembership(ctx, userID, teamID, false); err != nil {
		return SubmissionView{}, err
	}
	if in.Config.Plugin != nil && in.Config.Plugin.ArtifactID != "" {
		if _, err := local.Artifact(ctx, userID, teamID, in.Config.Plugin.ArtifactID); err != nil {
			return SubmissionView{}, err
		}
		if err := local.checkArtifact(ctx, teamID, in.Config.Plugin); err != nil {
			return SubmissionView{}, err
		}
	}
	configID := in.ConfigID
	if configID != "" {
		c, err := local.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(teamID)).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return SubmissionView{}, err
		}
		if c == nil {
			last, err := local.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID)).First(ctx)
			if err != nil && !ent.IsNotFound(err) {
				return SubmissionView{}, err
			}
			if last == nil {
				return SubmissionView{}, wire.E(http.StatusNotFound, "config_not_found")
			}
			if in.BaseVersion != 0 || string(last.Kind) != in.Config.Kind {
				return SubmissionView{}, wire.E(http.StatusConflict, "config_conflict")
			}
		} else if c.Version != in.BaseVersion || string(c.Kind) != in.Config.Kind {
			return SubmissionView{}, wire.E(http.StatusConflict, "config_conflict")
		}
	}
	var r *ent.ResourceSubmission
	if id == "" {
		if configID == "" {
			configID = ids.New()
		}
		r, err = local.DB.ResourceSubmission.Create().SetTeamID(teamID).SetAuthorID(userID).SetConfigID(configID).SetBaseVersion(in.BaseVersion).SetProposal(proposal(in.Config)).SetNote(in.Note).Save(ctx)
	} else {
		current, err := local.Submission(ctx, userID, teamID, id)
		if err != nil {
			return SubmissionView{}, err
		}
		if current.AuthorID != userID {
			return SubmissionView{}, wire.E(http.StatusForbidden, "submission_author_required")
		}
		if current.State != resourcesubmission.StateDraft || current.Revision != in.Revision {
			return SubmissionView{}, wire.E(http.StatusConflict, "submission_conflict")
		}
		// A new resource keeps the identity allocated with its first draft.
		if configID == "" {
			configID = current.ConfigID
		}
		n, e := local.DB.ResourceSubmission.Update().Where(resourcesubmission.ID(id), resourcesubmission.TeamID(teamID), resourcesubmission.StateEQ(resourcesubmission.StateDraft), resourcesubmission.Revision(in.Revision)).SetConfigID(configID).SetBaseVersion(in.BaseVersion).SetProposal(proposal(in.Config)).SetNote(in.Note).AddRevision(1).Save(ctx)
		if e != nil {
			return SubmissionView{}, e
		}
		if n != 1 {
			return SubmissionView{}, wire.E(http.StatusConflict, "submission_conflict")
		}
		r, err = local.DB.ResourceSubmission.Get(ctx, id)
	}
	if err != nil {
		return SubmissionView{}, err
	}
	if err := tx.Commit(); err != nil {
		return SubmissionView{}, err
	}
	return submissionView(r), nil
}

func (s *Service) DecideSubmission(ctx context.Context, userID, teamID, id, action string, in wire.ReviewInput) (SubmissionView, error) {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return SubmissionView{}, err
	}
	defer tx.Rollback()
	local := *s
	local.DB = tx.Client()
	admin := action == "approve" || action == "reject"
	if _, err := local.RequireMembership(ctx, userID, teamID, admin); err != nil {
		return SubmissionView{}, err
	}
	r, err := local.Submission(ctx, userID, teamID, id)
	if err != nil {
		return SubmissionView{}, err
	}
	if !admin && r.AuthorID != userID {
		return SubmissionView{}, wire.E(http.StatusForbidden, "submission_author_required")
	}
	target := map[string]resourcesubmission.State{"submit": resourcesubmission.StatePending, "approve": resourcesubmission.StatePublished, "reject": resourcesubmission.StateRejected, "withdraw": resourcesubmission.StateWithdrawn}[action]
	if target == "" {
		return SubmissionView{}, wire.E(http.StatusBadRequest, "invalid_request")
	}
	if r.State == target && r.Revision == in.Revision+1 {
		return submissionView(r), nil
	}
	expected := resourcesubmission.StatePending
	if action == "submit" {
		expected = resourcesubmission.StateDraft
	}
	if r.State != expected || r.Revision != in.Revision {
		return SubmissionView{}, wire.E(http.StatusConflict, "submission_conflict")
	}
	if action == "reject" && in.Reason == "" {
		return SubmissionView{}, wire.E(http.StatusBadRequest, "reason_required")
	}
	var config wire.ConfigInput
	if err := json.Unmarshal(r.Proposal, &config); err != nil {
		return SubmissionView{}, err
	}
	if err := config.Validate(); err != nil {
		return SubmissionView{}, err
	}
	if action == "submit" {
		if err := local.checkReferences(ctx, teamID, &config); err != nil {
			return SubmissionView{}, err
		}
	}
	update := local.DB.ResourceSubmission.Update().Where(resourcesubmission.ID(id), resourcesubmission.TeamID(teamID), resourcesubmission.StateEQ(expected), resourcesubmission.Revision(in.Revision)).SetState(target).AddRevision(1)
	if admin {
		update.SetReviewerID(userID).SetReason(in.Reason).SetDecidedAt(s.now())
	}
	n, err := update.Save(ctx)
	if err != nil {
		return SubmissionView{}, err
	}
	if n != 1 {
		return SubmissionView{}, wire.E(http.StatusConflict, "submission_conflict")
	}
	if action == "approve" {
		if _, err := local.publish(ctx, teamID, r.ConfigID, r.BaseVersion, config, r.AuthorID, userID, r.Note, "approved"); err != nil {
			return SubmissionView{}, err
		}
	}
	r, err = local.DB.ResourceSubmission.Get(ctx, id)
	if err != nil {
		return SubmissionView{}, err
	}
	if err := tx.Commit(); err != nil {
		return SubmissionView{}, err
	}
	return submissionView(r), nil
}

// SubmissionDetail applies the same author/admin visibility as listing.
func (s *Service) SubmissionDetail(ctx context.Context, userID, teamID, id string) (SubmissionView, error) {
	r, err := s.Submission(ctx, userID, teamID, id)
	if err != nil {
		return SubmissionView{}, err
	}
	return submissionView(r), nil
}
