package httpapi

import (
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/gateway"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func (s *Server) createTeam(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.CreateTeam
	if err := decode(r, &in); err != nil {
		return err
	}
	created, err := s.Team.CreateTeam(r.Context(), c.user.ID, in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, created)
	return nil
}

func (s *Server) createProvider(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.Provider
	if err := decode(r, &in); err != nil {
		return err
	}
	p, err := s.Team.CreateProvider(r.Context(), c.user.ID, r.PathValue("teamId"), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, p)
	return nil
}

func (s *Server) createConfig(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	var in wire.ConfigInput
	if err := decode(r, &in); err != nil {
		return err
	}
	view, err := s.Team.CreateConfig(r.Context(), c.user.ID, r.PathValue("teamId"), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, view)
	return nil
}

func (s *Server) configs(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	snap, err := s.Team.ConfigSnapshot(r.Context(), c.user.ID)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, snap)
	return nil
}

func (s *Server) completions(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireUser(r)
	if err != nil {
		return err
	}
	body, err := readBody(r, gateway.MaxBody)
	if err != nil {
		return err
	}
	return s.Gateway.Completions(w, r, c.user.ID, body)
}
