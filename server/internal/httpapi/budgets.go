package httpapi

import (
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamprovider"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/usage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func (s *Server) getBudgets(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	m, err := s.Team.RequireMembership(r.Context(), c.user.ID, r.PathValue("teamId"), false)
	if err != nil {
		return err
	}
	v, err := s.Usage.Budgets(r.Context(), m.TeamID, c.user.ID, m.Role == membership.RoleAdmin)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) setBudget(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	teamID := r.PathValue("teamId")
	if _, err := s.Team.RequireMembership(r.Context(), c.user.ID, teamID, true); err != nil {
		return err
	}
	var in usage.PolicyInput
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := in.Validate(); err != nil {
		return err
	}
	if in.Scope == "member" {
		if _, err := s.Team.RequireMembership(r.Context(), in.SubjectID, teamID, false); err != nil {
			return err
		}
	}
	if in.Scope == "provider" {
		exists, err := s.Team.DB.TeamProvider.Query().Where(teamprovider.TeamID(teamID), teamprovider.Name(in.SubjectID)).Exist(r.Context())
		if err != nil {
			return err
		}
		if !exists {
			return wire.E(http.StatusBadRequest, wire.ProviderNotConfigured)
		}
	}
	v, err := s.Usage.SetPolicy(r.Context(), teamID, c.user.ID, in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) resolveUsage(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	teamID := r.PathValue("teamId")
	if _, err := s.Team.RequireMembership(r.Context(), c.user.ID, teamID, true); err != nil {
		return err
	}
	var in usage.ResolutionInput
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Usage.Resolve(r.Context(), teamID, c.user.ID, r.PathValue("requestId"), in); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) listBudgetNotices(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	m, err := s.Team.RequireMembership(r.Context(), c.user.ID, r.PathValue("teamId"), false)
	if err != nil {
		return err
	}
	v, err := s.Usage.Notices(r.Context(), m.TeamID, c.user.ID, m.Role == membership.RoleAdmin)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) retryBudgetNotice(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	teamID := r.PathValue("teamId")
	if _, err := s.Team.RequireMembership(r.Context(), c.user.ID, teamID, true); err != nil {
		return err
	}
	var in struct{}
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Usage.RetryNotice(r.Context(), teamID, c.user.ID, r.PathValue("noticeId")); err != nil {
		return err
	}
	return noContent(w)
}
