package pages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/page"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/pagefile"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Meta is an upload's `meta` part.
type Meta struct {
	Title       string `json:"title"`
	Kind        string `json:"kind"`
	Note        string `json:"note"`
	SessionID   string `json:"sessionId"`
	Computer    string `json:"computer"`
	BaseVersion int    `json:"baseVersion"`
}

// Published is what an upload answers: the page and its new version.
type Published struct {
	ID      string `json:"id"`
	TeamID  string `json:"teamId"`
	Version int    `json:"version"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
}

// entries are each kind's one required file; markdown and svg pages are that
// file alone.
var entries = map[string]string{"html": "index.html", "markdown": "index.md", "svg": "index.svg"}

// types is every extension a page may hold and the type it is served as.
// Anything else is refused: a page is a page, not a file share.
var types = map[string]string{
	".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".json": "application/json", ".map": "application/json",
	".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
	".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
	".wasm": "application/wasm",
}

var segment = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9._-]*$`)

// validPath is a relative, slash-separated path of plain names: no empty,
// "." or ".." segment, and no hidden file.
func validPath(p string) bool {
	if p == "" || len(p) > 255 {
		return false
	}
	for _, s := range strings.Split(p, "/") {
		if !segment.MatchString(s) {
			return false
		}
	}
	return true
}

// pending is one uploaded file, read into a temporary file and hashed.
type pending struct {
	path, contentType, digest string
	size                      int64
	tmp                       *os.File
}

type upload struct {
	meta  Meta
	files []*pending
}

func (u *upload) close() {
	for _, f := range u.files {
		f.tmp.Close()
		os.Remove(f.tmp.Name())
	}
}

func invalid(message string, at ...any) error {
	var is wire.Issues
	is.Add(message, at...)
	return is.Err()
}

func tooLarge() error { return wire.E(http.StatusRequestEntityTooLarge, "page_too_large") }

// digestOf is a file's object id: the first 24 bytes of its SHA-256 in
// unpadded base64url, 32 characters (docs/tech/pages.md, "Object storage").
func digestOf(sum []byte) string { return base64.RawURLEncoding.EncodeToString(sum[:24]) }

// read takes a multipart upload apart: the `meta` part, then each file under
// its path, refusing what breaks a limit before anything is stored.
func read(r *http.Request) (*upload, error) {
	mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/form-data" || params["boundary"] == "" {
		return nil, invalid("Expected multipart/form-data")
	}
	body := http.MaxBytesReader(nil, r.Body, MaxVersionSize+1<<20)
	mr := multipart.NewReader(body, params["boundary"])
	u := &upload{}
	var total int64
	seenMeta, seen := false, map[string]bool{}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			u.close()
			return nil, tooLarge()
		}
		if err != nil {
			u.close()
			return nil, invalid("Malformed multipart body")
		}
		name := part.FormName()
		if name == "meta" && !seenMeta {
			seenMeta = true
			raw, err := io.ReadAll(io.LimitReader(part, 8<<10))
			if err == nil {
				err = wire.Decode(raw, &u.meta, true)
			}
			if err != nil {
				u.close()
				return nil, err
			}
			continue
		}
		ct, ok := types[strings.ToLower(path.Ext(name))]
		if !validPath(name) || !ok || seen[name] {
			u.close()
			return nil, invalid("A file's path or type is not allowed: "+name, "files", name)
		}
		seen[name] = true
		if len(u.files) == MaxFiles {
			u.close()
			return nil, tooLarge()
		}
		f, err := os.CreateTemp("", "teamwork-page-*")
		if err != nil {
			u.close()
			return nil, err
		}
		file := &pending{path: name, contentType: ct, tmp: f}
		u.files = append(u.files, file)
		hash := sha256.New()
		n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(part, MaxFileSize+1))
		if errors.As(err, &tooBig) || n > MaxFileSize {
			u.close()
			return nil, tooLarge()
		}
		if err != nil {
			u.close()
			return nil, invalid("Malformed multipart body")
		}
		if total += n; total > MaxVersionSize {
			u.close()
			return nil, tooLarge()
		}
		file.size, file.digest = n, digestOf(hash.Sum(nil))
	}
	if err := u.validate(); err != nil {
		u.close()
		return nil, err
	}
	return u, nil
}

func (u *upload) validate() error {
	m := &u.meta
	m.Title, m.Note = strings.TrimSpace(m.Title), strings.TrimSpace(m.Note)
	var is wire.Issues
	entry, ok := entries[m.Kind]
	if !ok {
		is.Add("html, markdown or svg", "kind")
	}
	if n := utf8.RuneCountInString(m.Title); n > 120 {
		is.Add("At most 120 characters", "title")
	}
	if utf8.RuneCountInString(m.Note) > 200 {
		is.Add("At most 200 characters", "note")
	}
	if len(m.SessionID) > 128 || utf8.RuneCountInString(m.Computer) > 64 || m.BaseVersion < 0 {
		is.Add("Invalid session, computer or base version")
	}
	if ok {
		has := false
		for _, f := range u.files {
			has = has || f.path == entry
		}
		if !has || (m.Kind != "html" && len(u.files) != 1) {
			is.Add("A "+m.Kind+" page is "+entry+(map[bool]string{true: " and the files it loads", false: " alone"}[m.Kind == "html"]), "files")
		}
	}
	return is.Err()
}

// author is the member a version is written as: the caller, who must be a
// member of the team now.
func (s *Service) author(ctx context.Context, c Caller, teamID string) (string, error) {
	if _, err := s.member(ctx, c, teamID); err != nil {
		return "", err
	}
	return c.UserID, nil
}

// Create publishes a new page at version 1, private to its author.
func (s *Service) Create(ctx context.Context, c Caller, teamID string, r *http.Request) (Published, error) {
	u, err := read(r)
	if err != nil {
		return Published{}, err
	}
	defer u.close()
	if u.meta.Title == "" {
		return Published{}, invalid("A title", "title")
	}
	author, err := s.author(ctx, c, teamID)
	if err != nil {
		return Published{}, err
	}
	id := ids.New()
	err = s.commit(ctx, teamID, u, func(tx *ent.Tx, at time.Time) error {
		return tx.Page.Create().SetID(id).SetTeamID(teamID).SetOwnerID(author).SetKind(page.Kind(u.meta.Kind)).
			SetTitle(u.meta.Title).SetCurrentVersion(1).SetUpdatedAt(at).Exec(ctx)
	}, id, 1, author)
	if err != nil {
		return Published{}, err
	}
	return Published{ID: id, TeamID: teamID, Version: 1, Title: u.meta.Title, Kind: u.meta.Kind}, nil
}

// AddVersion adds a version on top of meta.baseVersion, by a member who may
// read the page; a base that is no longer current is page_stale.
func (s *Service) AddVersion(ctx context.Context, c Caller, teamID, pageID string, r *http.Request) (Published, error) {
	u, err := read(r)
	if err != nil {
		return Published{}, err
	}
	defer u.close()
	author, err := s.author(ctx, c, teamID)
	if err != nil {
		return Published{}, err
	}
	p, err := s.readable(ctx, author, teamID, pageID)
	if err != nil {
		return Published{}, err
	}
	if string(p.Kind) != u.meta.Kind {
		return Published{}, invalid("A page keeps its kind", "kind")
	}
	if u.meta.BaseVersion != p.CurrentVersion {
		return Published{}, wire.E(http.StatusConflict, "page_stale")
	}
	title := p.Title
	if u.meta.Title != "" {
		title = u.meta.Title
	}
	next := u.meta.BaseVersion + 1
	err = s.commit(ctx, teamID, u, func(tx *ent.Tx, at time.Time) error {
		n, err := tx.Page.Update().Where(page.ID(p.ID), page.CurrentVersion(u.meta.BaseVersion)).
			SetCurrentVersion(next).SetUpdatedAt(at).SetTitle(title).Save(ctx)
		if err == nil && n == 0 {
			return wire.E(http.StatusConflict, "page_stale")
		}
		return err
	}, p.ID, next, author)
	if err != nil {
		return Published{}, err
	}
	return Published{ID: p.ID, TeamID: teamID, Version: next, Title: title, Kind: u.meta.Kind}, nil
}

// commit stores the files the team does not hold yet, then writes the page
// (head), the version and its files in one transaction. Objects this call
// wrote that no row names are deleted again when it fails.
func (s *Service) commit(ctx context.Context, teamID string, u *upload, head func(*ent.Tx, time.Time) error, pageID string, number int, author string) error {
	if s.Store == nil {
		return wire.E(http.StatusServiceUnavailable, "artifact_storage_unavailable")
	}
	held, err := s.teamUsage(ctx, teamID)
	if err != nil {
		return err
	}
	var fresh []*pending
	added := map[string]bool{}
	var total, extra int64
	for _, f := range u.files {
		total += f.size
		if _, ok := held[f.digest]; ok || added[f.digest] {
			continue
		}
		added[f.digest] = true
		fresh = append(fresh, f)
		extra += f.size
	}
	var used int64
	for _, size := range held {
		used += size
	}
	if used+extra > TeamQuota {
		return wire.E(http.StatusRequestEntityTooLarge, "page_team_full")
	}
	var written []string
	for _, f := range fresh {
		if _, err := f.tmp.Seek(0, io.SeekStart); err != nil {
			return err
		}
		if err := s.Store.PutObject(ctx, teamID, objectKind, f.digest, f.tmp, f.size); err != nil {
			s.forget(teamID, written)
			return err
		}
		written = append(written, f.digest)
	}
	at := s.now().Truncate(time.Microsecond)
	err = withTx(ctx, s.DB, func(tx *ent.Tx) error {
		if err := head(tx, at); err != nil {
			return err
		}
		v, err := tx.PageVersion.Create().SetPageID(pageID).SetNumber(number).SetAuthorID(author).
			SetComputer(u.meta.Computer).SetSessionID(u.meta.SessionID).SetNote(u.meta.Note).SetSize(total).SetCreatedAt(at).Save(ctx)
		if ent.IsConstraintError(err) {
			return wire.E(http.StatusConflict, "page_stale")
		}
		if err != nil {
			return err
		}
		rows := make([]*ent.PageFileCreate, len(u.files))
		for i, f := range u.files {
			rows[i] = tx.PageFile.Create().SetVersionID(v.ID).SetTeamID(teamID).SetPath(f.path).SetContentType(f.contentType).SetSize(f.size).SetDigest(f.digest)
		}
		return tx.PageFile.CreateBulk(rows...).Exec(ctx)
	})
	if err != nil {
		var we *wire.Error
		if errors.As(err, &we) {
			s.forget(teamID, written)
		} else {
			// A lost acknowledgement can follow a committed write: keep the
			// bytes rather than delete what a row may name (as ADR 0033).
			slog.Error("page outcome unknown; objects retained", "team", teamID, "page", pageID, "error", err)
		}
		return err
	}
	return nil
}

// forget deletes objects no file row of the team names.
func (s *Service) forget(teamID string, digests []string) {
	ctx := context.Background()
	for _, d := range digests {
		named, err := s.DB.PageFile.Query().Where(pagefile.TeamID(teamID), pagefile.Digest(d)).Exist(ctx)
		if err != nil || named {
			continue
		}
		if err := s.Store.DeleteObject(ctx, teamID, objectKind, d); err != nil {
			slog.Error("page object left behind", "team", teamID, "digest", d, "error", err)
		}
	}
}

// teamUsage is each distinct digest the team holds and its size.
func (s *Service) teamUsage(ctx context.Context, teamID string) (map[string]int64, error) {
	var rows []struct {
		Digest string `json:"digest"`
		Size   int64  `json:"max"`
	}
	err := s.DB.PageFile.Query().Where(pagefile.TeamID(teamID)).GroupBy(pagefile.FieldDigest).Aggregate(ent.Max(pagefile.FieldSize)).Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	held := make(map[string]int64, len(rows))
	for _, r := range rows {
		held[r.Digest] = r.Size
	}
	return held, nil
}

func withTx(ctx context.Context, db *ent.Client, fn func(*ent.Tx) error) error {
	tx, err := db.Tx(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
