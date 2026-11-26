package httpapi

import (
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
	"net/http"
	"strconv"
)

func pageOffset(r *http.Request) (int, error) {
	v := r.URL.Query().Get("offset")
	if v == "" {
		return 0, nil
	}
	n, e := strconv.Atoi(v)
	if e != nil || n < 0 || n > 1000000 {
		return 0, wire.E(400, "invalid_request")
	}
	return n, nil
}
func (s *Server) listSubmissions(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	offset, e := pageOffset(r)
	if e != nil {
		return e
	}
	rows, e := s.Team.ListSubmissions(r.Context(), c.user.ID, r.PathValue("teamId"), offset, r.URL.Query().Get("state"), r.URL.Query().Get("mine") == "true")
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, rows)
	return nil
}
func (s *Server) getSubmission(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	row, e := s.Team.SubmissionDetail(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"))
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, row)
	return nil
}

func (s *Server) assetChoices(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	result, err := s.Team.AssetChoices(r.Context(), c.user.ID, r.PathValue("teamId"))
	if err != nil {
		return err
	}
	noStore(w)
	writeJSON(w, http.StatusOK, result)
	return nil
}

func (s *Server) chooseAsset(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in team.PersonalChoice
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Team.ChooseAsset(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) setAssetHosts(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in team.AssetHosts
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Team.SetAssetHosts(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// setAssetHere is a DSH panel putting an item on its own computer, or taking it off: the computer is the relay host
// recorded for the caller's plugin sign-in.
func (s *Server) setAssetHere(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in struct {
		On bool `json:"on"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	host, err := s.Team.HostOfGrant(r.Context(), c.user.ID, c.grant)
	if err != nil {
		return err
	}
	if err := s.Team.SetAssetHere(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), host, in.On); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) setAssetDefault(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in team.TeamDefaultInput
	if err := decode(r, &in); err != nil {
		return err
	}
	if err := s.Team.SetAssetDefault(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
