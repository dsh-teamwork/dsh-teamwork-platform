package pages

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/page"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pagefile"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pagemember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pageversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Sharing is a page's sharing as PUT …/sharing takes it.
type Sharing struct {
	Mode    string   `json:"mode"`
	Members []string `json:"members"`
}

// role is how the caller stands to a page of their team: its owner, the
// team's admin, or neither. Only an owner widens a page's sharing; an admin
// governs every page without reading it (docs/tech/pages.md, "Terms").
type role int

const (
	other role = iota
	admin
	owner
)

// governed is a page of the team and the caller's role over it; a page they
// can neither read nor govern is page_not_found, so its existence is not told.
func (s *Service) governed(ctx context.Context, c Caller, teamID, pageID string) (*ent.Page, role, error) {
	m, err := s.member(ctx, c, teamID)
	if err != nil {
		return nil, other, err
	}
	p, err := s.DB.Page.Query().Where(page.ID(pageID), page.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, other, notFound()
	}
	if err != nil {
		return nil, other, err
	}
	switch {
	case p.OwnerID == c.UserID:
		return p, owner, nil
	case m.Role == membership.RoleAdmin:
		return p, admin, nil
	}
	ok, err := s.reads(ctx, c.UserID, p)
	if err != nil {
		return nil, other, err
	}
	if !ok {
		return nil, other, notFound()
	}
	return p, other, nil
}

func notOwner() error { return wire.E(http.StatusForbidden, "page_not_owner") }

// admitted is who a sharing lets read besides the owner: nil with all=true
// for the whole team.
func (s *Service) admitted(ctx context.Context, p *ent.Page) (ids map[string]bool, all bool, err error) {
	switch p.Sharing {
	case page.SharingTeam:
		return nil, true, nil
	case page.SharingMembers:
		rows, err := s.DB.PageMember.Query().Where(pagemember.PageID(p.ID)).All(ctx)
		if err != nil {
			return nil, false, err
		}
		ids = map[string]bool{}
		for _, r := range rows {
			ids[r.UserID] = true
		}
		return ids, false, nil
	}
	return map[string]bool{}, false, nil
}

// SetSharing sets a page's sharing: private, chosen members of its team, or
// the whole team. The owner sets any; an admin only narrows it, admitting no
// one it did not admit before, so an admin cannot share a page to read it.
func (s *Service) SetSharing(ctx context.Context, c Caller, teamID, pageID string, in Sharing) error {
	p, r, err := s.governed(ctx, c, teamID, pageID)
	if err != nil {
		return err
	}
	if r == other {
		return notOwner()
	}
	chosen := map[string]bool{}
	switch in.Mode {
	case "private", "team":
		if len(in.Members) != 0 {
			return invalid("Members go with mode members alone", "members")
		}
	case "members":
		if len(in.Members) == 0 || len(in.Members) > 500 {
			return invalid("Choose at least one member", "members")
		}
		for _, id := range in.Members {
			if id == p.OwnerID || len(id) > 32 {
				return invalid("Choose members other than the owner", "members")
			}
			chosen[id] = true
		}
		ids := make([]string, 0, len(chosen))
		for id := range chosen {
			ids = append(ids, id)
		}
		n, err := s.DB.Membership.Query().Where(membership.TeamID(teamID), membership.UserIDIn(ids...)).Count(ctx)
		if err != nil {
			return err
		}
		if n != len(ids) {
			return wire.E(http.StatusBadRequest, "page_member_not_in_team")
		}
	default:
		return invalid("private, members or team", "mode")
	}
	if r == admin {
		before, all, err := s.admitted(ctx, p)
		if err != nil {
			return err
		}
		widened := in.Mode == "team" && !all
		for id := range chosen {
			widened = widened || (!all && !before[id])
		}
		if widened {
			return wire.E(http.StatusForbidden, "page_sharing_widened")
		}
	}
	return withTx(ctx, s.DB, func(tx *ent.Tx) error {
		if err := tx.Page.UpdateOneID(p.ID).SetSharing(page.Sharing(in.Mode)).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.PageMember.Delete().Where(pagemember.PageID(p.ID)).Exec(ctx); err != nil {
			return err
		}
		if len(chosen) == 0 {
			return nil
		}
		rows := make([]*ent.PageMemberCreate, 0, len(chosen))
		for id := range chosen {
			rows = append(rows, tx.PageMember.Create().SetPageID(p.ID).SetUserID(id).SetAddedBy(c.UserID))
		}
		return tx.PageMember.CreateBulk(rows...).Exec(ctx)
	})
}

// Rename sets a page's title; its owner's alone.
func (s *Service) Rename(ctx context.Context, c Caller, teamID, pageID, title string) error {
	p, r, err := s.governed(ctx, c, teamID, pageID)
	if err != nil {
		return err
	}
	if r != owner {
		return notOwner()
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 120 {
		return invalid("A title of at most 120 characters", "title")
	}
	return s.DB.Page.UpdateOneID(p.ID).SetTitle(title).Exec(ctx)
}

// Restore adds a version copying version n's files: the owner's alone. Its
// bytes are already stored, so nothing is written but rows.
func (s *Service) Restore(ctx context.Context, c Caller, teamID, pageID string, n int) (Published, error) {
	p, r, err := s.governed(ctx, c, teamID, pageID)
	if err != nil {
		return Published{}, err
	}
	if r != owner {
		return Published{}, notOwner()
	}
	old, err := s.version(ctx, p.ID, n)
	if err != nil {
		return Published{}, err
	}
	files, err := s.DB.PageFile.Query().Where(pagefile.VersionID(old.ID)).All(ctx)
	if err != nil {
		return Published{}, err
	}
	next := p.CurrentVersion + 1
	at := s.now()
	err = withTx(ctx, s.DB, func(tx *ent.Tx) error {
		changed, err := tx.Page.Update().Where(page.ID(p.ID), page.CurrentVersion(p.CurrentVersion)).SetCurrentVersion(next).SetUpdatedAt(at).Save(ctx)
		if err == nil && changed == 0 {
			return wire.E(http.StatusConflict, "page_stale")
		}
		if err != nil {
			return err
		}
		v, err := tx.PageVersion.Create().SetPageID(p.ID).SetNumber(next).SetAuthorID(c.UserID).SetSize(old.Size).
			SetNote(restoredNote(n)).SetCreatedAt(at).Save(ctx)
		if err != nil {
			return err
		}
		rows := make([]*ent.PageFileCreate, len(files))
		for i, f := range files {
			rows[i] = tx.PageFile.Create().SetVersionID(v.ID).SetTeamID(teamID).SetPath(f.Path).SetContentType(f.ContentType).SetSize(f.Size).SetDigest(f.Digest)
		}
		return tx.PageFile.CreateBulk(rows...).Exec(ctx)
	})
	if err != nil {
		return Published{}, err
	}
	return Published{ID: p.ID, TeamID: teamID, Version: next, Title: p.Title, Kind: string(p.Kind)}, nil
}

func restoredNote(n int) string { return "Restored version " + strconv.Itoa(n) }

// Delete deletes a page, its versions, files and members, then each of its
// objects no other page of the team names. The owner or the team's admin.
func (s *Service) Delete(ctx context.Context, c Caller, teamID, pageID string) error {
	p, r, err := s.governed(ctx, c, teamID, pageID)
	if err != nil {
		return err
	}
	if r == other {
		return notOwner()
	}
	versions, err := s.DB.PageVersion.Query().Where(pageversion.PageID(p.ID)).IDs(ctx)
	if err != nil {
		return err
	}
	var digests []string
	if err := s.DB.PageFile.Query().Where(pagefile.VersionIDIn(versions...)).Unique(true).Select(pagefile.FieldDigest).Scan(ctx, &digests); err != nil {
		return err
	}
	err = withTx(ctx, s.DB, func(tx *ent.Tx) error {
		if _, err := tx.PageMember.Delete().Where(pagemember.PageID(p.ID)).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.PageFile.Delete().Where(pagefile.VersionIDIn(versions...)).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.PageVersion.Delete().Where(pageversion.PageID(p.ID)).Exec(ctx); err != nil {
			return err
		}
		return tx.Page.DeleteOneID(p.ID).Exec(ctx)
	})
	if err != nil {
		return err
	}
	if s.Store != nil {
		s.forget(teamID, digests)
	}
	return nil
}
