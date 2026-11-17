package httpapi

import (
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }

func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) listTeams(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	teams, err := s.Team.TeamsOf(r.Context(), c.user.ID)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, teams)
	return nil
}

func (s *Server) getTeam(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	v, err := s.Team.TeamOf(r.Context(), c.user.ID, r.PathValue("teamId"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) leaveTeam(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Team.LeaveTeam(r.Context(), c.user.ID, r.PathValue("teamId")); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) addMember(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.AddMember
	if err := decode(r, &in); err != nil {
		return err
	}
	added, err := s.Team.AddMember(r.Context(), c.user.ID, r.PathValue("teamId"), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, added)
	return nil
}

func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Team.RemoveMember(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("userId")); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) resetMemberPassword(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	pw, err := s.Team.ResetMemberPassword(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("userId"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"password": pw})
	return nil
}

func (s *Server) listInvites(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	invites, err := s.Team.ListInvites(r.Context(), c.user.ID, r.PathValue("teamId"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, invites)
	return nil
}

func (s *Server) createInvite(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	created, err := s.Team.CreateInvite(r.Context(), c.user.ID, r.PathValue("teamId"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, created)
	return nil
}

func (s *Server) revokeInvite(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Team.RevokeInvite(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id")); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) redeemInvite(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.RedeemInvite
	if err := decode(r, &in); err != nil {
		return err
	}
	teamID, err := s.Team.RedeemInvite(r.Context(), c.user.ID, in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]string{"teamId": teamID})
	return nil
}

func (s *Server) listConfigs(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	configs, err := s.Team.ListConfigs(r.Context(), c.user.ID, r.PathValue("teamId"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, configs)
	return nil
}

func (s *Server) updateConfig(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.UpdateConfig
	if err := decode(r, &in); err != nil {
		return err
	}
	v, err := s.Team.UpdateConfig(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) deleteConfig(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Team.DeleteConfig(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id")); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) listProviders(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	providers, err := s.Team.ListProviders(r.Context(), c.user.ID, r.PathValue("teamId"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, providers)
	return nil
}

func (s *Server) updateProvider(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.ProviderUpdate
	if err := decode(r, &in); err != nil {
		return err
	}
	v, err := s.Team.UpdateProvider(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

func (s *Server) deleteProvider(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Team.DeleteProvider(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id")); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) checkProvider(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.ProviderCheck
	if err := decode(r, &in); err != nil {
		return err
	}
	catalog, err := s.Team.CheckProvider(r.Context(), s.Gateway.Client, c.user.ID, r.PathValue("teamId"), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, catalog)
	return nil
}

func (s *Server) modelCatalog(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	provider := r.URL.Query().Get("provider")
	if provider == "" {
		var is wire.Issues
		is.Add("A provider name")
		return is.Err()
	}
	catalog, err := s.Team.ModelCatalog(r.Context(), s.Gateway.Client, c.user.ID, r.PathValue("teamId"), provider)
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, catalog)
	return nil
}

// Profile is GET and PATCH /api/profile.
type Profile struct {
	ID     string  `json:"id"`
	Email  *string `json:"email"`
	Name   *string `json:"name"`
	Image  *string `json:"image"`
	Locale *string `json:"locale"`
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	u := c.user
	writeJSON(w, http.StatusOK, Profile{ID: u.ID, Email: u.Email, Name: u.Name, Image: u.Image, Locale: u.Locale})
	return nil
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.UpdateProfile
	if err := decode(r, &in); err != nil {
		return err
	}
	update := c.user.Update()
	if in.Name.Set {
		update.SetNillableName(in.Name.Value)
		if in.Name.Value == nil {
			update.ClearName()
		}
	}
	if in.Locale.Set {
		update.SetNillableLocale(in.Locale.Value)
		if in.Locale.Value == nil {
			update.ClearLocale()
		}
	}
	u, err := update.Save(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, Profile{ID: u.ID, Email: u.Email, Name: u.Name, Image: u.Image, Locale: u.Locale})
	return nil
}

func (s *Server) handOverAdmin(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	if err := s.Team.HandOverAdmin(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("userId")); err != nil {
		return err
	}
	return noContent(w)
}

// deleteAccount closes the caller's account, from the browser or from the
// phone app with its own token (ADR 0040), and ends this browser's session.
// Any other session or token opens nothing once the row is gone; a computer
// token never reaches this route.
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.DeleteAccount
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Team.DeleteAccount(r.Context(), c.user.ID, in.Confirm); err != nil {
		return err
	}
	s.endSession(w)
	return noContent(w)
}
