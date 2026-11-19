package pages

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/page"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pageversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
)

// Person is someone a page names: its owner or a version's author.
type Person struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Email *string `json:"email"`
}

// Summary is a page as a list shows it.
type Summary struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Kind           string    `json:"kind"`
	Sharing        string    `json:"sharing"`
	Owner          Person    `json:"owner"`
	CurrentVersion int       `json:"currentVersion"`
	UpdatedAt      time.Time `json:"updatedAt"`
	UpdatedBy      Person    `json:"updatedBy"`
}

// VersionView is one version as a page's detail lists it.
type VersionView struct {
	Number    int       `json:"number"`
	Author    Person    `json:"author"`
	CreatedAt time.Time `json:"createdAt"`
	Note      string    `json:"note"`
	Computer  string    `json:"computer"`
	SessionID string    `json:"sessionId"`
	TeamDSH   bool      `json:"teamDsh"`
	Size      int64     `json:"size"`
}

// Detail is one page and its versions, newest first.
type Detail struct {
	Summary
	Versions []VersionView `json:"versions"`
}

// List is a page of a list and where the next one starts.
type List struct {
	Pages []Summary `json:"pages"`
	Next  *string   `json:"next"`
}

const listSize = 50

// List is the member's own pages of the team, newest version first, 50 at a
// time from before (a previous answer's next).
func (s *Service) List(ctx context.Context, c Caller, teamID, which, before string) (List, error) {
	if _, err := s.member(ctx, c, teamID); err != nil {
		return List{}, err
	}
	if which != "" && which != "mine" {
		return List{}, invalid("mine", "list")
	}
	q := s.DB.Page.Query().Where(page.TeamID(teamID), page.OwnerID(c.UserID))
	if before != "" {
		at, id, err := cursor(before)
		if err != nil {
			return List{}, err
		}
		q = q.Where(page.Or(page.UpdatedAtLT(at), page.And(page.UpdatedAt(at), page.IDLT(id))))
	}
	rows, err := q.Order(ent.Desc(page.FieldUpdatedAt), ent.Desc(page.FieldID)).Limit(listSize + 1).All(ctx)
	if err != nil {
		return List{}, err
	}
	out := List{Pages: []Summary{}}
	if len(rows) > listSize {
		rows = rows[:listSize]
		last := rows[listSize-1]
		next := strconv.FormatInt(last.UpdatedAt.UnixMicro(), 10) + "." + last.ID
		out.Next = &next
	}
	out.Pages, err = s.summaries(ctx, rows)
	return out, err
}

func cursor(before string) (time.Time, string, error) {
	at, id, ok := strings.Cut(before, ".")
	us, err := strconv.ParseInt(at, 10, 64)
	if !ok || err != nil || id == "" {
		return time.Time{}, "", invalid("A previous answer's next", "before")
	}
	return time.UnixMicro(us).UTC(), id, nil
}

// Get is one page the member may read, with its versions.
func (s *Service) Get(ctx context.Context, c Caller, teamID, pageID string) (Detail, error) {
	if _, err := s.member(ctx, c, teamID); err != nil {
		return Detail{}, err
	}
	p, err := s.readable(ctx, c.UserID, teamID, pageID)
	if err != nil {
		return Detail{}, err
	}
	sums, err := s.summaries(ctx, []*ent.Page{p})
	if err != nil {
		return Detail{}, err
	}
	versions, err := s.DB.PageVersion.Query().Where(pageversion.PageID(p.ID)).Order(ent.Desc(pageversion.FieldNumber)).All(ctx)
	if err != nil {
		return Detail{}, err
	}
	people, err := s.people(ctx, func(add func(string)) {
		for _, v := range versions {
			add(v.AuthorID)
		}
	})
	if err != nil {
		return Detail{}, err
	}
	d := Detail{Summary: sums[0], Versions: make([]VersionView, len(versions))}
	for i, v := range versions {
		d.Versions[i] = VersionView{Number: v.Number, Author: people(v.AuthorID), CreatedAt: v.CreatedAt.UTC(), Note: v.Note,
			Computer: v.Computer, SessionID: v.SessionID, TeamDSH: v.HostID != "", Size: v.Size}
	}
	return d, nil
}

// summaries names each page's owner and its newest version's author.
func (s *Service) summaries(ctx context.Context, rows []*ent.Page) ([]Summary, error) {
	if len(rows) == 0 {
		return []Summary{}, nil
	}
	ids := make([]string, len(rows))
	for i, p := range rows {
		ids[i] = p.ID
	}
	versions, err := s.DB.PageVersion.Query().Where(pageversion.PageIDIn(ids...)).All(ctx)
	if err != nil {
		return nil, err
	}
	author := map[string]string{}
	current := map[string]int{}
	for _, p := range rows {
		current[p.ID] = p.CurrentVersion
	}
	for _, v := range versions {
		if current[v.PageID] == v.Number {
			author[v.PageID] = v.AuthorID
		}
	}
	people, err := s.people(ctx, func(add func(string)) {
		for _, p := range rows {
			add(p.OwnerID)
			add(author[p.ID])
		}
	})
	if err != nil {
		return nil, err
	}
	out := make([]Summary, len(rows))
	for i, p := range rows {
		out[i] = Summary{ID: p.ID, Title: p.Title, Kind: string(p.Kind), Sharing: string(p.Sharing), Owner: people(p.OwnerID),
			CurrentVersion: p.CurrentVersion, UpdatedAt: p.UpdatedAt.UTC(), UpdatedBy: people(author[p.ID])}
	}
	return out, nil
}

// people loads the users collect names, once each.
func (s *Service) people(ctx context.Context, collect func(add func(string))) (func(string) Person, error) {
	set := map[string]bool{}
	collect(func(id string) {
		if id != "" {
			set[id] = true
		}
	})
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	users, err := s.DB.User.Query().Where(user.IDIn(ids...)).All(ctx)
	if err != nil {
		return nil, err
	}
	byID := map[string]*ent.User{}
	for _, u := range users {
		byID[u.ID] = u
	}
	return func(id string) Person {
		if u := byID[id]; u != nil {
			return Person{ID: u.ID, Name: u.Name, Email: u.Email}
		}
		return Person{ID: id}
	}, nil
}
