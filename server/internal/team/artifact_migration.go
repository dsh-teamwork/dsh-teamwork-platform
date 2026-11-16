package team

import (
	"context"
	"errors"
	"fmt"
	"io/fs"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifactstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/resourceartifact"
)

// MigrateArtifactPaths verifies current objects and copies missing team-scoped
// objects from the flat layout. Startup runs it before serving; authenticated
// reads also handle uploads from an old process during a rolling deployment.
func (s *Service) MigrateArtifactPaths(ctx context.Context) (int, error) {
	return s.eachArtifact(ctx, func(row *ent.ResourceArtifact) error {
		f, err := s.ArtifactFile(ctx, row)
		if err != nil {
			return err
		}
		return f.Close()
	})
}

// MigrateArtifacts copies local archives (either layout) into the configured
// store offline. It verifies both sides and never deletes or changes the source.
func (s *Service) MigrateArtifacts(ctx context.Context, sourceDir string) (int, error) {
	source := artifactstore.Local{Dir: sourceDir}
	return s.eachArtifact(ctx, func(row *ent.ResourceArtifact) error {
		body, err := source.Open(ctx, row.TeamID, row.ID)
		if errors.Is(err, fs.ErrNotExist) {
			body, err = source.OpenLegacy(ctx, row.ID)
		}
		if err != nil {
			return err
		}
		local, err := artifactSnapshot(body, row)
		if err != nil {
			return err
		}
		defer local.Close()
		body, err = s.Artifacts.Open(ctx, row.TeamID, row.ID)
		if errors.Is(err, fs.ErrNotExist) {
			if err := s.Artifacts.Put(ctx, row.TeamID, row.ID, local, row.Size); err != nil {
				return err
			}
			body, err = s.Artifacts.Open(ctx, row.TeamID, row.ID)
		}
		if err != nil {
			return err
		}
		remote, err := artifactSnapshot(body, row)
		if err != nil {
			return err
		}
		return remote.Close()
	})
}

func (s *Service) eachArtifact(ctx context.Context, visit func(*ent.ResourceArtifact) error) (int, error) {
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
			if err := visit(row); err != nil {
				return count, fmt.Errorf("migrate artifact %s in team %s: %w", row.ID, row.TeamID, err)
			}
			count++
			after = row.ID
		}
	}
}
