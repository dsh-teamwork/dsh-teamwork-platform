package relay

// A shared DSH's audit archive (docs/tech/shared-dsh.md, "The audit archive";
// ADR 0045). The DSH seals its members' records to a key only the team's admin
// holds and uploads them here as segments, in order; the server keeps each one
// exactly as uploaded and can open none.
//
//   - POST /relay/shared/archive (the DSH's host token): one segment, accepted
//     only as the next in its chain, signed by the DSH's bound identity key.
//   - GET /api/teams/{teamId}/shared-archive (a team admin): every shared DSH's
//     segments, deleted hosts included.
//   - GET /api/teams/{teamId}/shared-archive/{hostId} (a team admin): one
//     host's segments in order, one per line, for the admin's own tools.
//
// A segment is JSON: {v, host, seq, prev, key, enc, ct, sig}. prev is the
// SHA-256 of the previous segment's bytes ("" for the first), key the audit
// public key's fingerprint, enc and ct the HPKE encapsulation and ciphertext,
// and sig an Ed25519 signature by the DSH over segmentSigned.

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedarchivesegment"
)

// maxSegmentBytes bounds one upload: 1 MiB of records, sealed and in base64.
const maxSegmentBytes = 2 << 20

func (r *relay) archiveRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /relay/shared/archive", r.uploadSegment)
	mux.HandleFunc("GET /api/teams/{teamId}/shared-archive", r.teamAdmin(r.listArchive))
	mux.HandleFunc("GET /api/teams/{teamId}/shared-archive/{hostId}", r.teamAdmin(r.exportArchive))
}

type segment struct {
	V    int    `json:"v"`
	Host string `json:"host"`
	Seq  int64  `json:"seq"`
	Prev string `json:"prev"`
	Key  string `json:"key"`
	Enc  string `json:"enc"`
	CT   string `json:"ct"`
	Sig  string `json:"sig"`
}

// segmentSigned is what the DSH signs: the header, and a digest of what it
// sealed, so the server checks order and authorship without opening anything.
func segmentSigned(s segment) []byte {
	sealed := sha256.Sum256([]byte(s.Enc + "." + s.CT))
	return []byte("dsh-teamwork audit segment\n" + s.Host + "\n" + strconv.FormatInt(s.Seq, 10) + "\n" + s.Prev + "\n" + s.Key + "\n" + hex.EncodeToString(sealed[:]))
}

func (r *relay) uploadSegment(w http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	token, _ := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer ")
	hostID, err := r.sharedHostOf(ctx, strings.TrimSpace(token))
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	if hostID == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	body, err := io.ReadAll(io.LimitReader(req.Body, maxSegmentBytes+1))
	if err != nil || len(body) > maxSegmentBytes {
		errorJSON(w, http.StatusRequestEntityTooLarge, "segment_too_large")
		return
	}
	var s segment
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if d.Decode(&s) != nil || s.V != 1 || s.Host != hostID || s.Seq < 1 || len(s.Key) != 64 || s.Enc == "" || s.CT == "" {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	sig, err := base64.StdEncoding.DecodeString(s.Sig)
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	h, err := r.db.SharedHost.Get(ctx, hostID)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	public, err := base64.StdEncoding.DecodeString(derefOr(h.IdentityKey))
	if err != nil || len(public) != ed25519.PublicKeySize || !ed25519.Verify(public, segmentSigned(s), sig) {
		errorJSON(w, http.StatusForbidden, "segment_signature")
		return
	}
	// The next in its chain, or nothing: the previous segment's digest must be the one it names.
	last, err := r.db.SharedArchiveSegment.Query().Where(sharedarchivesegment.HostID(hostID)).
		Order(ent.Desc(sharedarchivesegment.FieldSeq)).First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		rejectedJSON(w, err)
		return
	}
	wantSeq, wantPrev := int64(1), ""
	if last != nil {
		wantSeq, wantPrev = last.Seq+1, last.Digest
	}
	digest := sha256.Sum256(body)
	if last != nil && s.Seq == last.Seq && hex.EncodeToString(digest[:]) == last.Digest {
		// A retried upload of what is already here: it landed.
		writeJSON(w, http.StatusOK, map[string]any{"seq": s.Seq, "digest": last.Digest})
		return
	}
	if s.Seq != wantSeq || s.Prev != wantPrev {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "archive_out_of_order", "next": wantSeq, "prev": wantPrev})
		return
	}
	err = r.db.SharedArchiveSegment.Create().SetHostID(hostID).SetTeamID(h.TeamID).SetSeq(s.Seq).SetPrevDigest(s.Prev).
		SetDigest(hex.EncodeToString(digest[:])).SetData(body).Exec(ctx)
	if ent.IsConstraintError(err) {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "archive_out_of_order"})
		return
	}
	if err != nil {
		slog.Error("relay: archive segment", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"seq": s.Seq, "digest": hex.EncodeToString(digest[:])})
}

func derefOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

type archiveHostView struct {
	HostID   string `json:"hostId"`
	Name     string `json:"name"`
	Deleted  bool   `json:"deleted"`
	Segments int    `json:"segments"`
	FirstAt  string `json:"firstAt"`
	LastAt   string `json:"lastAt"`
	LastSeq  int64  `json:"lastSeq"`
	LastHash string `json:"lastDigest"`
}

func (r *relay) listArchive(w http.ResponseWriter, req *http.Request, _, teamID string) error {
	ctx := req.Context()
	rows, err := r.db.SharedArchiveSegment.Query().Where(sharedarchivesegment.TeamID(teamID)).
		Order(ent.Asc(sharedarchivesegment.FieldHostID), ent.Asc(sharedarchivesegment.FieldSeq)).
		Select(sharedarchivesegment.FieldHostID, sharedarchivesegment.FieldSeq, sharedarchivesegment.FieldDigest, sharedarchivesegment.FieldCreatedAt).All(ctx)
	if err != nil {
		return err
	}
	hosts, err := r.db.SharedHost.Query().All(ctx)
	if err != nil {
		return err
	}
	names := map[string]string{}
	for _, h := range hosts {
		names[h.ID] = h.Name
	}
	views := []archiveHostView{}
	index := map[string]int{}
	for _, s := range rows {
		i, ok := index[s.HostID]
		if !ok {
			name, live := names[s.HostID]
			views = append(views, archiveHostView{HostID: s.HostID, Name: name, Deleted: !live, FirstAt: iso(s.CreatedAt)})
			i = len(views) - 1
			index[s.HostID] = i
		}
		v := &views[i]
		v.Segments++
		v.LastAt, v.LastSeq, v.LastHash = iso(s.CreatedAt), s.Seq, s.Digest
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": views})
	return nil
}

// exportArchive writes one host's segments in order, one JSON object per line,
// exactly as the DSH uploaded them.
func (r *relay) exportArchive(w http.ResponseWriter, req *http.Request, _, teamID string) error {
	ctx, hostID := req.Context(), req.PathValue("hostId")
	ids, err := r.db.SharedArchiveSegment.Query().Where(sharedarchivesegment.TeamID(teamID), sharedarchivesegment.HostID(hostID)).
		Order(ent.Asc(sharedarchivesegment.FieldSeq)).IDs(ctx)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return errNotFound
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", `attachment; filename="shared-archive-`+hostID+`.ndjson"`)
	w.Header().Set("Cache-Control", "no-store")
	for _, id := range ids {
		s, err := r.db.SharedArchiveSegment.Get(ctx, id)
		if err != nil {
			return err
		}
		w.Write(s.Data)
		w.Write([]byte("\n"))
	}
	return nil
}
