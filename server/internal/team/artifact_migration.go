package team

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifactstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourceartifact"
)

// MigrateArtifacts runs offline with writes stopped. It never deletes source
// files or changes metadata, and a retry verifies/copies the same immutable keys.
func (s *Service) MigrateArtifacts(ctx context.Context, sourceDir string) (int, error) {
	source := &Service{Artifacts: artifactstore.Local{Dir: sourceDir}}
	count, after := 0, ""
	for {
		rows, err := s.DB.ResourceArtifact.Query().Where(resourceartifact.IDGT(after)).Order(resourceartifact.ByID()).Limit(100).All(ctx)
		if err != nil {
			return count, err
		}
		if len(rows) == 0 {
			return count, nil
		}
		for _, row := range rows {
			err := func() error {
				local, err := source.ArtifactFile(ctx, row.ID)
				if err != nil {
					return err
				}
				defer local.Close()
				verify := func(r io.Reader) error {
					h := sha256.New()
					n, err := io.Copy(h, r)
					if err != nil {
						return err
					}
					if n != row.Size || hex.EncodeToString(h.Sum(nil)) != row.Sha256 {
						return fmt.Errorf("size or SHA-256 mismatch")
					}
					return nil
				}
				if err := verify(local); err != nil {
					return err
				}
				if _, err := local.Seek(0, 0); err != nil {
					return err
				}
				if err := s.Artifacts.Put(ctx, row.ID, local, row.Size); err != nil {
					return err
				}
				remote, err := s.ArtifactFile(ctx, row.ID)
				if err != nil {
					return err
				}
				defer remote.Close()
				return verify(remote)
			}()
			if err != nil {
				return count, fmt.Errorf("migrate artifact %s: %w", row.ID, err)
			}
			count++
			after = row.ID
		}
	}
}
