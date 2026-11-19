// Package pages holds every rule about pages (docs/tech/pages.md): what an
// agent publishes from a session, kept as versioned files under its team,
// read only by those its sharing admits, and served under /p/ from an origin
// of its own in a sandbox. internal/httpapi maps routes to it.
package pages

import (
	"context"
	"net/http"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/artifactstore"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/page"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pagemember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Limits (docs/tech/pages.md, "Object storage").
const (
	MaxVersionSize = 16 << 20
	MaxFiles       = 255
	MaxFileSize    = 5 << 20
)

// TeamQuota is the most a team's distinct page files may hold; a variable so
// a test can reach it without writing 2 GiB.
var TeamQuota int64 = 2 << 30

// objectKind is the pages' kind in the object store: teams/{team}/pages/{digest}.
const objectKind = "pages"

// Service is the pages' rules over the database and the object store.
type Service struct {
	DB    *ent.Client
	Store artifactstore.Store
	Team  *team.Service
	// Sealer seals and opens view addresses (auth.PageView).
	Sealer *auth.Sealer
	// ContentURL is the origin /p/ is served from, without a trailing slash.
	ContentURL string
	Now        func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Caller is who asks: a member (UserID), on behalf of a Team DSH when HostID
// is set. TeamID, when set, is the one team a computer or host token reaches.
type Caller struct {
	UserID string
	HostID string
	TeamID string
}

func notFound() error { return wire.E(http.StatusNotFound, "page_not_found") }

// member re-reads the caller's membership of teamID: a team they are not in
// is a 404, as for every team route, and a token for one team reaches no
// other.
func (s *Service) member(ctx context.Context, c Caller, teamID string) (*ent.Membership, error) {
	if c.TeamID != "" && c.TeamID != teamID {
		return nil, wire.E(http.StatusNotFound, wire.TeamNotFound)
	}
	return s.Team.RequireMembership(ctx, c.UserID, teamID, false)
}

// readable is the page of teamID the member may read, or page_not_found:
// its owner, everyone in the team when shared with it, or a member it names.
// An admin is a reader only where the sharing admits them like anyone else.
func (s *Service) readable(ctx context.Context, userID, teamID, pageID string) (*ent.Page, error) {
	p, err := s.DB.Page.Query().Where(page.ID(pageID), page.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound()
	}
	if err != nil {
		return nil, err
	}
	ok, err := s.reads(ctx, userID, p)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, notFound()
	}
	return p, nil
}

func (s *Service) reads(ctx context.Context, userID string, p *ent.Page) (bool, error) {
	switch {
	case p.OwnerID == userID, p.Sharing == page.SharingTeam:
		return true, nil
	case p.Sharing == page.SharingMembers:
		return s.DB.PageMember.Query().Where(pagemember.PageID(p.ID), pagemember.UserID(userID)).Exist(ctx)
	}
	return false, nil
}
