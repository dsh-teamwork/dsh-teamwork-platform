package knowledge

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
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeattachment"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// Limits on attachments (docs/tech/knowledge.md, "Attachments"); variables
// so a test can reach them without writing gigabytes.
var (
	MaxAttachment       int64 = 20 << 20
	TeamAttachmentQuota int64 = 2 << 30
)

// ObjectKind is knowledge's kind in the object store:
// teams/{team}/knowledge/{digest}.
const ObjectKind = "knowledge"

// attachmentTypes is every extension an attachment may have and the type it is
// served as. Anything else is refused: knowledge keeps documents and what
// they show, not a file share.
var attachmentTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
	".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
	".json": "application/json",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".zip":  "application/zip",
}

// Attachment is a file a document names, as a document lists it.
type Attachment struct {
	Name        string `json:"name"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

func attachmentView(a *ent.KnowledgeAttachment) Attachment {
	return Attachment{Name: a.Name, ContentType: a.ContentType, Size: a.Size}
}

// attachmentName checks an attachment's name: a document name with an
// extension attachmentTypes allows, which says what it is.
func attachmentName(v string) (string, string, error) {
	n, err := name(v, 120, "name")
	if err != nil {
		return "", "", err
	}
	if strings.ContainsAny(n, "[]|#^") {
		return "", "", invalid("A name with none of [ ] | # ^, which a link to it could not hold", "name")
	}
	ct, ok := attachmentTypes[strings.ToLower(path.Ext(n))]
	if !ok {
		return "", "", invalid("An image, PDF, text, CSV, JSON, Office or zip file", "name")
	}
	return n, ct, nil
}

func digestOf(sum []byte) string { return base64.RawURLEncoding.EncodeToString(sum[:24]) }

// attachments lists a document's attachments by name.
func (s *Service) attachments(ctx context.Context, documentID string) ([]Attachment, error) {
	rows, err := s.DB.KnowledgeAttachment.Query().Where(knowledgeattachment.DocumentID(documentID)).
		Order(ent.Asc(knowledgeattachment.FieldName)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Attachment, len(rows))
	for i, r := range rows {
		out[i] = attachmentView(r)
	}
	return out, nil
}

// Attach stores the one file of a multipart body (part "file", its file name
// the attachment's name) on a document the caller reads. A reader's and an
// agent's upload is allowed: a file does nothing until a version names it,
// and only an editor makes a version. The same name with the same bytes is
// the same attachment; with other bytes it is knowledge_name_taken, since
// versions that name it must keep showing what they showed.
func (s *Service) Attach(ctx context.Context, c Caller, teamID, documentID string, r *http.Request) (Attachment, bool, error) {
	if s.Store == nil {
		return Attachment{}, false, wire.E(http.StatusServiceUnavailable, "knowledge_storage_unavailable")
	}
	d, _, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Attachment{}, false, err
	}
	file, err := readAttachment(r)
	if err != nil {
		return Attachment{}, false, err
	}
	defer file.close()
	existing, err := s.DB.KnowledgeAttachment.Query().Where(knowledgeattachment.DocumentID(d.ID), knowledgeattachment.Name(file.name)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return Attachment{}, false, err
	}
	if existing != nil {
		if existing.Digest == file.digest {
			return attachmentView(existing), false, nil
		}
		return Attachment{}, false, taken()
	}
	held, err := s.DB.KnowledgeAttachment.Query().Where(knowledgeattachment.TeamID(teamID), knowledgeattachment.Digest(file.digest)).Exist(ctx)
	if err != nil {
		return Attachment{}, false, err
	}
	wrote := false
	if !held {
		used, err := s.teamUsage(ctx, teamID)
		if err != nil {
			return Attachment{}, false, err
		}
		if used+file.size > TeamAttachmentQuota {
			return Attachment{}, false, wire.E(http.StatusRequestEntityTooLarge, "knowledge_team_full")
		}
		if _, err := file.tmp.Seek(0, io.SeekStart); err != nil {
			return Attachment{}, false, err
		}
		if err := s.Store.PutObject(ctx, teamID, ObjectKind, file.digest, file.tmp, file.size); err != nil {
			return Attachment{}, false, err
		}
		wrote = true
	}
	row, err := s.DB.KnowledgeAttachment.Create().SetTeamID(teamID).SetDocumentID(d.ID).SetName(file.name).
		SetContentType(file.contentType).SetSize(file.size).SetDigest(file.digest).SetCreatedBy(c.UserID).Save(ctx)
	if err != nil {
		if wrote {
			s.Forget(context.WithoutCancel(ctx), teamID, []string{file.digest})
		}
		if ent.IsConstraintError(err) {
			return Attachment{}, false, taken()
		}
		return Attachment{}, false, err
	}
	return attachmentView(row), true, nil
}

// teamUsage is the bytes of a team's distinct attachments.
func (s *Service) teamUsage(ctx context.Context, teamID string) (int64, error) {
	var rows []struct {
		Digest string `json:"digest"`
		Size   int64  `json:"size"`
	}
	if err := s.DB.KnowledgeAttachment.Query().Where(knowledgeattachment.TeamID(teamID)).
		GroupBy(knowledgeattachment.FieldDigest, knowledgeattachment.FieldSize).Scan(ctx, &rows); err != nil {
		return 0, err
	}
	seen := map[string]bool{}
	var used int64
	for _, r := range rows {
		if !seen[r.Digest] {
			seen[r.Digest] = true
			used += r.Size
		}
	}
	return used, nil
}

// OpenAttachment is one attachment of a document the caller reads, and its
// bytes, which the caller closes.
func (s *Service) OpenAttachment(ctx context.Context, c Caller, teamID, documentID, attachment string) (Attachment, io.ReadCloser, string, error) {
	d, _, err := s.document(ctx, c, teamID, documentID)
	if err != nil {
		return Attachment{}, nil, "", err
	}
	row, err := s.DB.KnowledgeAttachment.Query().Where(knowledgeattachment.DocumentID(d.ID), knowledgeattachment.Name(attachment)).Only(ctx)
	if ent.IsNotFound(err) {
		return Attachment{}, nil, "", notFound()
	}
	if err != nil {
		return Attachment{}, nil, "", err
	}
	if s.Store == nil {
		return Attachment{}, nil, "", wire.E(http.StatusServiceUnavailable, "knowledge_storage_unavailable")
	}
	body, err := s.Store.OpenObject(ctx, teamID, ObjectKind, row.Digest)
	if err != nil {
		return Attachment{}, nil, "", err
	}
	return attachmentView(row), body, row.Digest, nil
}

// Forget deletes the objects of teamID no attachment still names. A file a
// failed delete leaves behind is logged: its rows are gone, so nothing
// reaches it.
func (s *Service) Forget(ctx context.Context, teamID string, digests []string) {
	if s.Store == nil {
		return
	}
	forget(ctx, s.DB, s.Store, teamID, digests)
}

// objectDeleter is what Forget needs of the object store.
type objectDeleter interface {
	DeleteObject(ctx context.Context, teamID, kind, id string) error
}

func forget(ctx context.Context, db *ent.Client, store objectDeleter, teamID string, digests []string) {
	for _, d := range digests {
		named, err := db.KnowledgeAttachment.Query().Where(knowledgeattachment.TeamID(teamID), knowledgeattachment.Digest(d)).Exist(ctx)
		if err != nil || named {
			continue
		}
		if err := store.DeleteObject(ctx, teamID, ObjectKind, d); err != nil {
			slog.Warn("deleted knowledge attachment left in storage", "team", teamID, "digest", d, "error", err)
		}
	}
}

// pendingFile is an uploaded attachment, read into a temporary file and hashed.
type pendingFile struct {
	name, contentType, digest string
	size                      int64
	tmp                       *os.File
}

func (f *pendingFile) close() {
	f.tmp.Close()
	os.Remove(f.tmp.Name())
}

func tooLargeAttachment() error {
	return wire.E(http.StatusRequestEntityTooLarge, "knowledge_too_large")
}

// readAttachment takes the one "file" part of a multipart body, refusing what
// breaks a limit before anything is stored.
func readAttachment(r *http.Request) (*pendingFile, error) {
	mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/form-data" || params["boundary"] == "" {
		return nil, invalid("Expected multipart/form-data")
	}
	body := http.MaxBytesReader(nil, r.Body, MaxAttachment+64<<10)
	mr := multipart.NewReader(body, params["boundary"])
	part, err := mr.NextPart()
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return nil, tooLargeAttachment()
	}
	if err != nil || part.FormName() != "file" {
		return nil, invalid("One part named file, with its file name", "file")
	}
	n, ct, err := attachmentName(part.FileName())
	if err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp("", "teamwork-knowledge-*")
	if err != nil {
		return nil, err
	}
	f := &pendingFile{name: n, contentType: ct, tmp: tmp}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, hash), io.LimitReader(part, MaxAttachment+1))
	if errors.As(err, &tooBig) || size > MaxAttachment {
		f.close()
		return nil, tooLargeAttachment()
	}
	if err != nil {
		f.close()
		return nil, invalid("Malformed multipart body")
	}
	if size == 0 {
		f.close()
		return nil, invalid("An empty file", "file")
	}
	if _, err := mr.NextPart(); !errors.Is(err, io.EOF) {
		f.close()
		return nil, invalid("One file at a time", "file")
	}
	f.size, f.digest = size, digestOf(hash.Sum(nil))
	return f, nil
}
