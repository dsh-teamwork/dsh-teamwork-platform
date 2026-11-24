package team

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/configrevision"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pluginpackage"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

func recordRevision(ctx context.Context, db *ent.Client, c *ent.TeamConfig, author, reviewer, note, source string) error {
	return db.ConfigRevision.Create().SetTeamID(c.TeamID).SetConfigID(c.ID).SetVersion(c.Version).SetKind(configrevision.Kind(c.Kind)).SetName(c.Name).SetData(c.Data).SetAuthorID(author).SetReviewerID(reviewer).SetNote(note).SetSource(configrevision.Source(source)).SetBuiltin(builtinName(c.Builtin)).Exec(ctx)
}

// publish is called only inside a transaction, after membership has been checked.
// The versioned live write and immutable history commit together.
func (s *Service) publish(ctx context.Context, teamID, configID string, base int, in wire.ConfigInput, author, reviewer, note, source string) (*ent.TeamConfig, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	if err := s.checkReferences(ctx, teamID, &in); err != nil {
		return nil, err
	}
	var current *ent.TeamConfig
	var err error
	if configID != "" {
		current, err = s.DB.TeamConfig.Query().Where(teamconfig.ID(configID), teamconfig.TeamID(teamID)).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
	}
	version := 1
	restoredBuiltin := ""
	if current != nil {
		if current.RouteOwner != "" {
			return nil, wire.E(http.StatusForbidden, "config_owned")
		}
		if string(current.Kind) != in.Kind {
			var issues wire.Issues
			issues.Add("A configuration keeps its kind", "kind")
			return nil, issues.Err()
		}
		if in.Plugin != nil {
			var old wire.PluginData
			if json.Unmarshal(current.Data, &old) == nil && old.Package == in.Plugin.Package && old.Version == in.Plugin.Version && (old.PackageID != in.Plugin.PackageID || old.SHA256 != in.Plugin.SHA256) {
				return nil, wire.E(http.StatusConflict, "package_version_exists")
			}
		}
		if current.Version != base {
			return nil, wire.E(http.StatusConflict, "config_conflict")
		}
		exists, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID), configrevision.Version(base)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if !exists {
			if err := recordRevision(ctx, s.DB, current, "", "", "Imported baseline", "legacy"); err != nil {
				return nil, err
			}
		}
		n, err := s.DB.TeamConfig.Update().Where(teamconfig.ID(configID), teamconfig.TeamID(teamID), teamconfig.Version(base)).SetName(in.Name).SetData(in.Canonical()).AddVersion(1).Save(ctx)
		if err != nil {
			return nil, conflict(err, wire.ConfigExists)
		}
		if n != 1 {
			return nil, wire.E(http.StatusConflict, "config_conflict")
		}
		current, err = s.DB.TeamConfig.Get(ctx, configID)
		if err != nil {
			return nil, err
		}
	} else {
		if base != 0 {
			return nil, wire.E(http.StatusConflict, "config_conflict")
		}
		if configID != "" {
			last, err := s.DB.ConfigRevision.Query().Where(configrevision.TeamID(teamID), configrevision.ConfigID(configID)).Order(ent.Desc(configrevision.FieldVersion)).First(ctx)
			if err != nil && !ent.IsNotFound(err) {
				return nil, err
			}
			if last != nil {
				if string(last.Kind) != in.Kind {
					return nil, wire.E(http.StatusConflict, "config_conflict")
				}
				version = last.Version + 1
				restoredBuiltin = last.Builtin
			}
		}
		create := s.DB.TeamConfig.Create().SetTeamID(teamID).SetKind(teamconfig.Kind(in.Kind)).SetName(in.Name).SetData(in.Canonical()).SetVersion(version)
		if restoredBuiltin != "" {
			create.SetBuiltin(restoredBuiltin)
		}
		if configID != "" {
			create.SetID(configID)
		}
		current, err = create.Save(ctx)
		if err != nil {
			return nil, conflict(err, wire.ConfigExists)
		}
	}
	if in.Plugin != nil && in.Plugin.PackageID != "" {
		if _, err := s.DB.PluginPackage.Update().Where(pluginpackage.ID(in.Plugin.PackageID), pluginpackage.TeamID(teamID)).SetPublished(true).Save(ctx); err != nil {
			return nil, err
		}
	}
	if err := recordRevision(ctx, s.DB, current, author, reviewer, note, source); err != nil {
		return nil, err
	}
	return current, nil
}

func (s *Service) publishDirect(ctx context.Context, userID, teamID, configID string, base int, in wire.ConfigInput) (ConfigView, error) {
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return ConfigView{}, err
	}
	defer tx.Rollback()
	scoped := *s
	scoped.DB = tx.Client()
	if _, err := scoped.RequireMembership(ctx, userID, teamID, true); err != nil {
		return ConfigView{}, err
	}
	c, err := scoped.publish(ctx, teamID, configID, base, in, userID, userID, "", "direct")
	if err != nil {
		return ConfigView{}, err
	}
	if err := tx.Commit(); err != nil {
		return ConfigView{}, err
	}
	return configView(c), nil
}

// RevisionView never includes provider keys or authentication material.
type RevisionView struct {
	ID         string          `json:"id"`
	ConfigID   string          `json:"configId"`
	Kind       string          `json:"kind"`
	Name       string          `json:"name"`
	Data       json.RawMessage `json:"data"`
	Version    int             `json:"version"`
	AuthorID   string          `json:"authorId"`
	ReviewerID string          `json:"reviewerId"`
	Note       string          `json:"note"`
	Source     string          `json:"source"`
	CreatedAt  string          `json:"createdAt"`
}

func revisionView(r *ent.ConfigRevision) RevisionView {
	return RevisionView{r.ID, r.ConfigID, string(r.Kind), r.Name, r.Data, r.Version, r.AuthorID, r.ReviewerID, r.Note, string(r.Source), Time(r.CreatedAt)}
}
