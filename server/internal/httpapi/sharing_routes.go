package httpapi

import (
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
	rows, e := s.Team.ListSubmissions(r.Context(), c.user.ID, r.PathValue("teamId"), offset, r.URL.Query().Get("state"))
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, rows)
	return nil
}
func (s *Server) saveSubmission(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	var in wire.SubmissionInput
	if e := decode(r, &in); e != nil {
		return e
	}
	row, e := s.Team.SaveSubmission(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in)
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, row)
	return nil
}
func (s *Server) decideSubmission(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	var in wire.ReviewInput
	if e := decode(r, &in); e != nil {
		return e
	}
	row, e := s.Team.DecideSubmission(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), r.PathValue("action"), in)
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, row)
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
