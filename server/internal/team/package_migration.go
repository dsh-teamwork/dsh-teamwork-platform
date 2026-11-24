package team

import (
	"context"
	"errors"
	"fmt"
	"io/fs"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pluginpackage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/objectstore"
)

// MigratePackagePaths verifies current objects and copies missing team-scoped
// objects from the flat layout. Startup runs it before serving; authenticated
// reads also handle uploads from an old process during a rolling deployment.
func (s *Service) MigratePackagePaths(ctx context.Context) (int, error) {
	return s.eachPackage(ctx, func(row *ent.PluginPackage) error {
		f, err := s.PackageFile(ctx, row)
		if err != nil {
			return err
		}
		return f.Close()
	})
}

// MigratePackages copies local archives (either layout) into the configured
// store offline. It verifies both sides and never deletes or changes the source.
func (s *Service) MigratePackages(ctx context.Context, sourceDir string) (int, error) {
	source := objectstore.Local{Dir: sourceDir}
	return s.eachPackage(ctx, func(row *ent.PluginPackage) error {
		body, err := source.Open(ctx, row.TeamID, row.ID)
		if errors.Is(err, fs.ErrNotExist) {
			body, err = source.OpenLegacy(ctx, row.ID)
		}
		if err != nil {
			return err
		}
		local, err := packageSnapshot(body, row)
		if err != nil {
			return err
		}
		defer local.Close()
		body, err = s.Objects.Open(ctx, row.TeamID, row.ID)
		if errors.Is(err, fs.ErrNotExist) {
			if err := s.Objects.Put(ctx, row.TeamID, row.ID, local, row.Size); err != nil {
				return err
			}
			body, err = s.Objects.Open(ctx, row.TeamID, row.ID)
		}
		if err != nil {
			return err
		}
		remote, err := packageSnapshot(body, row)
		if err != nil {
			return err
		}
		return remote.Close()
	})
}

func (s *Service) eachPackage(ctx context.Context, visit func(*ent.PluginPackage) error) (int, error) {
	count, after := 0, ""
	for {
		rows, err := s.DB.PluginPackage.Query().Where(pluginpackage.IDGT(after)).Order(pluginpackage.ByID()).Limit(100).All(ctx)
		if err != nil {
			return count, err
		}
		if len(rows) == 0 {
			return count, nil
		}
		for _, row := range rows {
			if err := visit(row); err != nil {
				return count, fmt.Errorf("migrate package %s in team %s: %w", row.ID, row.TeamID, err)
			}
			count++
			after = row.ID
		}
	}
}
