package team

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pluginpackage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

const MaxPackageSize int64 = 10 << 20
const MaxExpandedSize int64 = 64 << 20
const MaxPackageEntries = 2000

type PackageView struct {
	ID        string   `json:"id"`
	Package   string   `json:"package"`
	Version   string   `json:"version"`
	SHA256    string   `json:"sha256"`
	Size      int64    `json:"size"`
	Files     []string `json:"files"`
	Published bool     `json:"published"`
}

func packageView(r *ent.PluginPackage) PackageView {
	return PackageView{r.ID, r.Package, r.Version, r.Sha256, r.Size, r.Files, r.Published}
}

var privateKey = regexp.MustCompile(`-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})`)

// InspectPackage never extracts or executes archive contents.
func InspectPackage(input io.Reader) (string, string, []string, error) {
	bad := func() (string, string, []string, error) { return "", "", nil, wire.E(400, "unsafe_package") }
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
		if len(seen) >= MaxPackageEntries || h.Size < 0 || h.Size > MaxExpandedSize {
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
func (s *Service) UploadPackage(ctx context.Context, userID, teamID string, input io.Reader) (PackageView, error) {
	if _, err := s.RequireMembership(ctx, userID, teamID, false); err != nil {
		return PackageView{}, err
	}
	if s.Objects == nil {
		return PackageView{}, wire.E(503, "package_storage_unavailable")
	}
	f, err := os.CreateTemp("", "teamwork-upload-*")
	if err != nil {
		return PackageView{}, err
	}
	defer func() { f.Close(); os.Remove(f.Name()) }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(input, MaxPackageSize+1))
	if err != nil {
		return PackageView{}, err
	}
	if n > MaxPackageSize {
		return PackageView{}, wire.E(413, wire.PayloadTooLarge)
	}
	if _, err := f.Seek(0, 0); err != nil {
		return PackageView{}, err
	}
	pkg, version, files, err := InspectPackage(f)
	if err != nil {
		return PackageView{}, err
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	existing, err := s.DB.PluginPackage.Query().Where(pluginpackage.TeamID(teamID), pluginpackage.Package(pkg), pluginpackage.Version(version)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return PackageView{}, err
	}
	if existing != nil {
		if existing.AuthorID == userID && existing.Sha256 == digest {
			// An identical retry also repairs missing bytes after a failed migration
			// or an interrupted deployment. Metadata and publication stay unchanged.
			if _, err := f.Seek(0, 0); err != nil {
				return PackageView{}, err
			}
			if err := s.Objects.Put(ctx, existing.TeamID, existing.ID, f, n); err != nil {
				return PackageView{}, err
			}
			return packageView(existing), nil
		}
		return PackageView{}, wire.E(409, "package_version_exists")
	}
	id := ids.New()
	if _, err := f.Seek(0, 0); err != nil {
		return PackageView{}, err
	}
	if err := s.Objects.Put(ctx, teamID, id, f, n); err != nil {
		return PackageView{}, err
	}
	r, err := s.DB.PluginPackage.Create().SetID(id).SetTeamID(teamID).SetAuthorID(userID).SetPackage(pkg).SetVersion(version).SetSha256(digest).SetSize(n).SetFiles(files).Save(ctx)
	if err != nil {
		if !ent.IsConstraintError(err) {
			// A lost DB acknowledgement can follow a committed insert. Retain the
			// object until reconciliation rather than deleting possibly referenced bytes.
			slog.Error("package metadata outcome unknown; bytes retained", "package", id, "error", err)
			return PackageView{}, err
		}
		// Request cancellation must not skip cleanup after a rejected DB write.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if cleanupErr := s.Objects.Delete(cleanup, teamID, id); cleanupErr != nil {
			slog.Error("package cleanup failed", "package", id, "error", cleanupErr)
		}
		return PackageView{}, wire.E(409, "package_version_exists")
	}
	return packageView(r), nil
}
func (s *Service) Package(ctx context.Context, userID, teamID, id string) (*ent.PluginPackage, error) {
	m, err := s.RequireMembership(ctx, userID, teamID, false)
	if err != nil {
		return nil, err
	}
	r, err := s.DB.PluginPackage.Query().Where(pluginpackage.ID(id), pluginpackage.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, wire.E(404, "package_not_found")
	}
	if err != nil {
		return nil, err
	}
	if !r.Published && r.AuthorID != userID && m.Role != membership.RoleAdmin {
		return nil, wire.E(404, "package_not_found")
	}
	return r, nil
}

// packageFile is a bounded, seekable snapshot for downloads and tar exports.
// Close removes the temporary copy; durable bytes belong to the provider.
type packageFile struct{ *os.File }

func (f *packageFile) Close() error {
	closeErr := f.File.Close()
	removeErr := os.Remove(f.Name())
	if closeErr != nil {
		return closeErr
	}
	return removeErr
}

// PackageFile takes an already authorized database row, never a caller's path.
// A flat object is copied only when the team-scoped object is absent.
func (s *Service) PackageFile(ctx context.Context, row *ent.PluginPackage) (*packageFile, error) {
	if s.Objects == nil {
		return nil, wire.E(503, "package_storage_unavailable")
	}
	body, err := s.Objects.Open(ctx, row.TeamID, row.ID)
	if errors.Is(err, fs.ErrNotExist) {
		legacy, err := s.Objects.OpenLegacy(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		source, err := packageSnapshot(legacy, row)
		if err != nil {
			return nil, err
		}
		defer source.Close()
		if err := s.Objects.Put(ctx, row.TeamID, row.ID, source, row.Size); err != nil {
			return nil, err
		}
		// Verify the destination rather than serving the source and assuming the
		// remote write succeeded. Retain the original for recovery and rollback.
		body, err = s.Objects.Open(ctx, row.TeamID, row.ID)
		if err != nil {
			return nil, err
		}
		return packageSnapshot(body, row)
	}
	if err != nil {
		return nil, err
	}
	return packageSnapshot(body, row)
}

func packageSnapshot(body io.ReadCloser, row *ent.PluginPackage) (*packageFile, error) {
	defer body.Close()
	f, err := os.CreateTemp("", "teamwork-package-*")
	if err != nil {
		return nil, err
	}
	file := &packageFile{f}
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(body, MaxPackageSize+1))
	if err == nil && (n > MaxPackageSize || n != row.Size || hex.EncodeToString(hash.Sum(nil)) != row.Sha256) {
		err = wire.E(409, "package_mismatch")
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
func (s *Service) checkPackage(ctx context.Context, teamID string, data *wire.PluginData) error {
	if data.PackageID == "" {
		return nil
	}
	r, err := s.DB.PluginPackage.Query().Where(pluginpackage.ID(data.PackageID), pluginpackage.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return wire.E(400, "package_not_found")
	}
	if err != nil {
		return err
	}
	if r.Package != data.Package || r.Version != data.Version || r.Sha256 != data.SHA256 {
		return wire.E(400, "package_mismatch")
	}
	f, err := s.PackageFile(ctx, r)
	if err != nil {
		var detail *wire.Error
		if errors.As(err, &detail) {
			return err
		}
		return wire.E(409, "package_unavailable")
	}
	defer f.Close()
	return nil
}
