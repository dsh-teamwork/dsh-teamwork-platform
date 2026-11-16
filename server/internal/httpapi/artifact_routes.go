package httpapi

import (
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"net/http"
)

func (s *Server) uploadArtifact(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	row, e := s.Team.UploadArtifact(r.Context(), c.user.ID, r.PathValue("teamId"), r.Body)
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, row)
	return nil
}
func (s *Server) artifactInfo(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	row, e := s.Team.Artifact(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"))
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, team.ArtifactView{ID: row.ID, Package: row.Package, Version: row.Version, SHA256: row.Sha256, Size: row.Size, Files: row.Files, Published: row.Published})
	return nil
}
func (s *Server) downloadArtifact(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	row, e := s.Team.Artifact(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"))
	if e != nil {
		return e
	}
	file, e := s.Team.ArtifactFile(r.Context(), row.ID)
	if e != nil {
		return e
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="plugin.tgz"`)
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "plugin.tgz", row.CreatedAt, file)
	return nil
}
