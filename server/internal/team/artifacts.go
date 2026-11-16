package team

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourceartifact"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

const MaxArtifactSize int64 = 10 << 20
const MaxExpandedSize int64 = 64 << 20
const MaxArtifactEntries = 2000

type ArtifactView struct {
	ID        string   `json:"id"`
	Package   string   `json:"package"`
	Version   string   `json:"version"`
	SHA256    string   `json:"sha256"`
	Size      int64    `json:"size"`
	Files     []string `json:"files"`
	Published bool     `json:"published"`
}

func artifactView(r *ent.ResourceArtifact) ArtifactView {
	return ArtifactView{r.ID, r.Package, r.Version, r.Sha256, r.Size, r.Files, r.Published}
}

var privateKey = regexp.MustCompile(`-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})`)

// InspectArtifact never extracts or executes archive contents.
func InspectArtifact(input io.Reader) (string, string, []string, error) {
	bad := func() (string, string, []string, error) { return "", "", nil, wire.E(400, "unsafe_artifact") }
	gz, err := gzip.NewReader(input)
	if err != nil {
		return bad()
	}
	defer gz.Close()
	limited := &io.LimitedReader{R: gz, N: MaxExpandedSize + 1}
	tr := tar.NewReader(limited)
	seen := map[string]bool{}
	files := []string{}
	var manifest struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return bad()
		}
		if len(seen) >= MaxArtifactEntries || h.Size < 0 || h.Size > MaxExpandedSize {
			return bad()
		}
		name := strings.TrimSuffix(h.Name, "/")
		if name == "package" && h.Typeflag == tar.TypeDir {
			if seen[name] || h.Size != 0 {
				return bad()
			}
			seen[name] = true
			continue
		}
		if strings.Contains(name, ":") || name == "" || name != path.Clean(name) || strings.Contains(name, "\\") || !strings.HasPrefix(name, "package/") || seen[name] {
			return bad()
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA && h.Typeflag != tar.TypeDir {
			return bad()
		}
		seen[name] = true
		if h.Typeflag == tar.TypeDir {
			if h.Size != 0 {
				return bad()
			}
			continue
		}
		base := strings.ToLower(path.Base(name))
		if base == ".env" || strings.HasPrefix(base, ".env.") || base == ".npmrc" || base == ".netrc" || strings.HasPrefix(base, "id_rsa") || strings.HasSuffix(base, ".pem") || strings.HasSuffix(base, ".key") || strings.Contains(name, "/.git/") || strings.Contains(name, "/.aws/") || strings.Contains(name, "/.ssh/") {
			return bad()
		}
		data, err := io.ReadAll(io.LimitReader(tr, MaxExpandedSize+1))
		if err != nil || limited.N <= 0 || privateKey.Match(data) {
			return bad()
		}
		files = append(files, name)
		if name == "package/package.json" {
			if len(data) > 65536 || json.Unmarshal(data, &manifest) != nil {
				return bad()
			}
		}
	}
	// Drain gzip to verify the checksum and enforce the expanded-stream limit.
	tail, err := io.ReadAll(limited)
	if err != nil || limited.N <= 0 {
		return bad()
	}
	for _, b := range tail {
		if b != 0 {
			return bad()
		}
	}
	in := wire.ConfigInput{Kind: "plugin", Name: "Upload"}
	data, _ := json.Marshal(wire.PluginData{Package: manifest.Name, Version: manifest.Version})
	in.Data = data
	if in.Validate() != nil || len(manifest.Name) > 214 || len(manifest.Version) > 100 {
		return bad()
	}
	return manifest.Name, manifest.Version, files, nil
}
func (s *Service) UploadArtifact(ctx context.Context, userID, teamID string, input io.Reader) (ArtifactView, error) {
	if _, err := s.RequireMembership(ctx, userID, teamID, false); err != nil {
		return ArtifactView{}, err
	}
	if s.Artifacts == nil {
		return ArtifactView{}, wire.E(503, "artifact_storage_unavailable")
	}
	f, err := os.CreateTemp("", "teamwork-upload-*")
	if err != nil {
		return ArtifactView{}, err
	}
	defer func() { f.Close(); os.Remove(f.Name()) }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(input, MaxArtifactSize+1))
	if err != nil {
		return ArtifactView{}, err
	}
	if n > MaxArtifactSize {
		return ArtifactView{}, wire.E(413, wire.PayloadTooLarge)
	}
	if _, err := f.Seek(0, 0); err != nil {
		return ArtifactView{}, err
	}
	pkg, version, files, err := InspectArtifact(f)
	if err != nil {
		return ArtifactView{}, err
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	existing, err := s.DB.ResourceArtifact.Query().Where(resourceartifact.TeamID(teamID), resourceartifact.Package(pkg), resourceartifact.Version(version)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return ArtifactView{}, err
	}
	if existing != nil {
		if existing.AuthorID == userID && existing.Sha256 == digest {
			// An identical retry also repairs missing bytes after a failed migration
			// or an interrupted deployment. Metadata and publication stay unchanged.
			if _, err := f.Seek(0, 0); err != nil {
				return ArtifactView{}, err
			}
			if err := s.Artifacts.Put(ctx, existing.ID, f, n); err != nil {
				return ArtifactView{}, err
			}
			return artifactView(existing), nil
		}
		return ArtifactView{}, wire.E(409, "artifact_version_exists")
	}
	id := ids.New()
	if _, err := f.Seek(0, 0); err != nil {
		return ArtifactView{}, err
	}
	if err := s.Artifacts.Put(ctx, id, f, n); err != nil {
		return ArtifactView{}, err
	}
	r, err := s.DB.ResourceArtifact.Create().SetID(id).SetTeamID(teamID).SetAuthorID(userID).SetPackage(pkg).SetVersion(version).SetSha256(digest).SetSize(n).SetFiles(files).Save(ctx)
	if err != nil {
		// Request cancellation must not skip cleanup after a rejected DB write.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if cleanupErr := s.Artifacts.Delete(cleanup, id); cleanupErr != nil {
			slog.Error("artifact cleanup failed", "artifact", id, "error", cleanupErr)
		}
		if ent.IsConstraintError(err) {
			return ArtifactView{}, wire.E(409, "artifact_version_exists")
		}
		return ArtifactView{}, err
	}
	return artifactView(r), nil
}
func (s *Service) Artifact(ctx context.Context, userID, teamID, id string) (*ent.ResourceArtifact, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	r, err := s.DB.ResourceArtifact.Query().Where(resourceartifact.ID(id), resourceartifact.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, wire.E(404, "artifact_not_found")
	}
	if err != nil {
		return nil, err
	}
	if !r.Published && r.AuthorID != userID && m.Role != membership.RoleAdmin {
		return nil, wire.E(404, "artifact_not_found")
	}
	return r, nil
}

// artifactFile is a bounded, seekable snapshot for downloads and tar exports.
// Close removes the temporary copy; durable bytes belong to the provider.
type artifactFile struct{ *os.File }

func (f *artifactFile) Close() error {
	closeErr := f.File.Close()
	removeErr := os.Remove(f.Name())
	if closeErr != nil {
		return closeErr
	}
	return removeErr
}

func (s *Service) ArtifactFile(ctx context.Context, id string) (*artifactFile, error) {
	if s.Artifacts == nil {
		return nil, wire.E(503, "artifact_storage_unavailable")
	}
	body, err := s.Artifacts.Open(ctx, id)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	f, err := os.CreateTemp("", "teamwork-artifact-*")
	if err != nil {
		return nil, err
	}
	file := &artifactFile{f}
	n, err := io.Copy(f, io.LimitReader(body, MaxArtifactSize+1))
	if err == nil && n > MaxArtifactSize {
		err = fmt.Errorf("stored artifact exceeds size limit")
	}
	if err == nil {
		_, err = f.Seek(0, 0)
	}
	if err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}
func (s *Service) checkArtifact(ctx context.Context, teamID string, data *wire.PluginData) error {
	if data.ArtifactID == "" {
		return nil
	}
	r, err := s.DB.ResourceArtifact.Query().Where(resourceartifact.ID(data.ArtifactID), resourceartifact.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(400, "artifact_not_found")
	}
	if err != nil {
		return err
	}
	if r.Package != data.Package || r.Version != data.Version || r.Sha256 != data.SHA256 {
		return wire.E(400, "artifact_mismatch")
	}
	f, err := s.ArtifactFile(ctx, r.ID)
	if err != nil {
		return wire.E(409, "artifact_unavailable")
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != r.Sha256 {
		return wire.E(409, "artifact_mismatch")
	}
	return nil
}
