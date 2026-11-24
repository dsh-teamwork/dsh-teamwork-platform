package httpapi

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
	"io"
	"net/http"
	"os"
	"time"
)

func historyTime(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	t, e := time.Parse(time.RFC3339, value)
	if e != nil {
		return nil, wire.E(400, "invalid_request")
	}
	return &t, nil
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	offset, e := pageOffset(r)
	if e != nil {
		return e
	}
	from, e := historyTime(r.URL.Query().Get("from"))
	if e != nil {
		return e
	}
	to, e := historyTime(r.URL.Query().Get("to"))
	if e != nil {
		return e
	}
	if from != nil && to != nil && !from.Before(*to) {
		return wire.E(400, "invalid_request")
	}
	rows, e := s.Team.History(r.Context(), c.user.ID, r.PathValue("teamId"), r.URL.Query().Get("configId"), r.URL.Query().Get("kind"), r.URL.Query().Get("authorId"), from, to, offset)
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, rows)
	return nil
}
func (s *Server) restoreRevision(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	var in struct {
		BaseVersion int    `json:"baseVersion"`
		Note        string `json:"note"`
	}
	if e := decode(r, &in); e != nil {
		return e
	}
	row, e := s.Team.RestoreRevision(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"), in.BaseVersion, in.Note)
	if e != nil {
		return e
	}
	noStore(w)
	writeJSON(w, 200, row)
	return nil
}
func (s *Server) exportRevision(w http.ResponseWriter, r *http.Request) error {
	c, e := s.requireUser(r)
	if e != nil {
		return e
	}
	snapshot, ids, e := s.Team.ExportRevision(r.Context(), c.user.ID, r.PathValue("teamId"), r.PathValue("id"))
	if e != nil {
		return e
	}
	files := []interface {
		io.ReadCloser
		Stat() (os.FileInfo, error)
	}{}
	defer func() {
		for _, f := range files {
			f.Close()
		}
	}()
	for _, id := range ids {
		row, e := s.Team.Package(r.Context(), c.user.ID, r.PathValue("teamId"), id)
		if e != nil {
			return e
		}
		f, e := s.Team.PackageFile(r.Context(), row)
		if e != nil {
			return e
		}
		files = append(files, f)
	}
	manifest, e := json.MarshalIndent(snapshot, "", "  ")
	if e != nil {
		return e
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="teamwork-backup.tgz"`)
	w.Header().Set("Cache-Control", "private, no-store")
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	if e := tw.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(manifest))}); e != nil {
		return e
	}
	if _, e := tw.Write(manifest); e != nil {
		return e
	}
	for i, f := range files {
		stat, e := f.Stat()
		if e != nil {
			return e
		}
		if e := tw.WriteHeader(&tar.Header{Name: "packages/" + ids[i] + ".tgz", Mode: 0600, Size: stat.Size()}); e != nil {
			return e
		}
		if _, e := io.Copy(tw, f); e != nil {
			return e
		}
	}
	if e := tw.Close(); e != nil {
		return e
	}
	return gz.Close()
}
