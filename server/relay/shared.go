package relay

// Shared DSHs (docs/tech/shared-dsh.md): a DSH a team shares with its
// members, signed in by a team host key rather than by any person.
//
//   - /api/teams/{teamId}/shared-hosts (a team admin's browser session):
//     list, create (the key is shown once), rename, rotate the key, delete.
//   - POST /relay/shared/challenge and POST /relay/shared/token (the plugin,
//     with the key): a nonce, then a host token (platform ADR 0047) for a
//     signature of the nonce by the DSH's identity key. The first exchange
//     binds that key to the host; every later one must be signed by it, so a
//     key copied to another machine is refused.

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedarchivesegment"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedhost"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedhostmember"
)

const errInvalidInput rejected = "invalid_input"

const (
	hostKeyPrefix = "dshh_"
	// nonceTTL is how long a challenge may be answered.
	nonceTTL = 2 * time.Minute
	// hostTokenTTL is how long a host token lives; the plugin renews it.
	hostTokenTTL = time.Hour
)

func (r *relay) sharedRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/teams/{teamId}/shared-hosts", r.teamAdmin(r.listShared))
	mux.HandleFunc("POST /api/teams/{teamId}/shared-hosts", r.teamAdmin(r.createShared))
	mux.HandleFunc("PATCH /api/teams/{teamId}/shared-hosts/{id}", r.teamAdmin(r.renameShared))
	mux.HandleFunc("POST /api/teams/{teamId}/shared-hosts/{id}/rotate", r.teamAdmin(r.rotateShared))
	mux.HandleFunc("DELETE /api/teams/{teamId}/shared-hosts/{id}", r.teamAdmin(r.deleteShared))
	mux.HandleFunc("POST /relay/shared/challenge", r.sharedChallenge)
	mux.HandleFunc("POST /relay/shared/token", r.sharedToken)
}

// --- keys ------------------------------------------------------------------

// newHostKey is a key for host id and the HMAC it is stored as.
func (r *relay) newHostKey(id string) (key, hash string) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(err)
	}
	key = hostKeyPrefix + id + "_" + base64.RawURLEncoding.EncodeToString(secret)
	return key, r.pairings.mac("shared-host-key", key)
}

// newHostID is a shared host's id: it is part of the key, so it carries no
// underscore.
func newHostID() string {
	b := make([]byte, 15)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// hostKeyID is the host id a key names, or "" for a value that is no key.
func hostKeyID(key string) string {
	rest, ok := strings.CutPrefix(key, hostKeyPrefix)
	if !ok || len(key) > 200 {
		return ""
	}
	id, secret, ok := strings.Cut(rest, "_")
	if !ok || id == "" || len(id) > 32 || len(secret) != 43 {
		return ""
	}
	return id
}

// --- the admin's routes ------------------------------------------------------

type sharedView struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Bound      bool    `json:"bound"`
	BoundAt    *string `json:"boundAt"`
	LastSeenAt *string `json:"lastSeenAt"`
	CreatedAt  string  `json:"createdAt"`
	// Access is who may reach it: "team", or "listed" for MemberIDs alone.
	Access    string   `json:"access"`
	MemberIDs []string `json:"memberIds"`
}

func isoPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := iso(*t)
	return &s
}

func (r *relay) sharedViewWithMembers(ctx context.Context, h *ent.SharedHost) (sharedView, error) {
	ids, err := r.db.SharedHostMember.Query().Where(sharedhostmember.HostID(h.ID)).Order(ent.Asc(sharedhostmember.FieldUserID)).Select(sharedhostmember.FieldUserID).Strings(ctx)
	if err != nil {
		return sharedView{}, err
	}
	return sharedView{ID: h.ID, Name: h.Name, Bound: h.IdentityKey != nil, BoundAt: isoPtr(h.BoundAt), LastSeenAt: isoPtr(h.LastSeenAt),
		CreatedAt: iso(h.CreatedAt), Access: string(h.Access), MemberIDs: ids}, nil
}

type adminHandler func(w http.ResponseWriter, req *http.Request, userID, teamID string) error

// teamAdmin admits a team admin's browser session: a write must come from
// this site and carry JSON. Membership is re-read on every request.
func (r *relay) teamAdmin(next adminHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		who, err := r.host.Session(req)
		if err != nil {
			teamFailure(w, err)
			return
		}
		if who == nil {
			errorJSON(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		teamID := req.PathValue("teamId")
		if _, err := r.host.TeamRole(req.Context(), who.UserID, teamID, true); err != nil {
			teamFailure(w, err)
			return
		}
		if req.Method != http.MethodGet {
			if !r.host.SameOrigin(req) {
				errorJSON(w, http.StatusForbidden, "cross_origin")
				return
			}
			if req.Method != http.MethodDelete && !strings.HasPrefix(strings.ToLower(req.Header.Get("Content-Type")), "application/json") {
				errorJSON(w, http.StatusUnsupportedMediaType, "unsupported_media_type")
				return
			}
		}
		if err := next(w, req, who.UserID, teamID); err != nil {
			teamFailure(w, err)
		}
	}
}

// teamFailure answers a coded error with its own status and code, and
// anything else as an internal failure.
func teamFailure(w http.ResponseWriter, err error) {
	var coded interface {
		HTTPStatus() int
		ErrorCode() string
	}
	if errors.As(err, &coded) {
		errorJSON(w, coded.HTTPStatus(), coded.ErrorCode())
		return
	}
	var rej rejected
	if errors.As(err, &rej) {
		rejectedJSON(w, err)
		return
	}
	slog.Error("relay: shared host request failed", "error", err)
	errorJSON(w, http.StatusInternalServerError, "internal")
}

func readJSON(req *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(req.Body, 4<<10+1))
	if err != nil || len(body) > 4<<10 {
		return errInvalidInput
	}
	d := json.NewDecoder(strings.NewReader(string(body)))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		return errInvalidInput
	}
	return nil
}

// sharedName is a trimmed display name of 1 to 100 characters.
func sharedName(req *http.Request) (string, error) {
	var in struct {
		Name string `json:"name"`
	}
	if err := readJSON(req, &in); err != nil {
		return "", err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return "", errInvalidInput
	}
	return name, nil
}

func (r *relay) sharedOf(ctx context.Context, teamID, id string) (*ent.SharedHost, error) {
	h, err := r.db.SharedHost.Query().Where(sharedhost.ID(id), sharedhost.TeamID(teamID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, errNotFound
	}
	return h, err
}

func (r *relay) listShared(w http.ResponseWriter, req *http.Request, _, teamID string) error {
	rows, err := r.db.SharedHost.Query().Where(sharedhost.TeamID(teamID)).Order(ent.Asc(sharedhost.FieldCreatedAt), ent.Asc(sharedhost.FieldID)).All(req.Context())
	if err != nil {
		return err
	}
	out := make([]sharedView, 0, len(rows))
	for _, h := range rows {
		v, err := r.sharedViewWithMembers(req.Context(), h)
		if err != nil {
			return err
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": out})
	return nil
}

func (r *relay) createShared(w http.ResponseWriter, req *http.Request, userID, teamID string) error {
	name, err := sharedName(req)
	if err != nil {
		return err
	}
	id := newHostID()
	key, hash := r.newHostKey(id)
	h, err := r.db.SharedHost.Create().SetID(id).SetTeamID(teamID).SetName(name).SetKeyHash(hash).SetCreatedBy(userID).Save(req.Context())
	if err != nil {
		return err
	}
	v, err := r.sharedViewWithMembers(req.Context(), h)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"host": v, "key": key})
	return nil
}

func (r *relay) renameShared(w http.ResponseWriter, req *http.Request, _, teamID string) error {
	name, err := sharedName(req)
	if err != nil {
		return err
	}
	h, err := r.sharedOf(req.Context(), teamID, req.PathValue("id"))
	if err != nil {
		return err
	}
	if h, err = h.Update().SetName(name).Save(req.Context()); err != nil {
		return err
	}
	v, err := r.sharedViewWithMembers(req.Context(), h)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": v})
	return nil
}

// rotateShared gives a host a new key, keeping its machine: the old key stops
// at its next exchange.
func (r *relay) rotateShared(w http.ResponseWriter, req *http.Request, _, teamID string) error {
	if err := readJSON(req, &struct{}{}); err != nil {
		return err
	}
	h, err := r.sharedOf(req.Context(), teamID, req.PathValue("id"))
	if err != nil {
		return err
	}
	key, hash := r.newHostKey(h.ID)
	if h, err = h.Update().SetKeyHash(hash).Save(req.Context()); err != nil {
		return err
	}
	v, err := r.sharedViewWithMembers(req.Context(), h)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": v, "key": key})
	return nil
}

// deleteShared revokes a host: its key stops at once, and a host token it
// already holds lives out at most its hour.
func (r *relay) deleteShared(w http.ResponseWriter, req *http.Request, _, teamID string) error {
	ctx, id := req.Context(), req.PathValue("id")
	n := 0
	err := withTx(ctx, r.db, func(tx *ent.Tx) error {
		var err error
		if n, err = tx.SharedHost.Delete().Where(sharedhost.ID(id), sharedhost.TeamID(teamID)).Exec(ctx); err != nil || n == 0 {
			return err
		}
		return deleteSharedRows(ctx, tx.Client(), []string{id})
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return errNotFound
	}
	r.dropHost(id)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- the plugin's exchange --------------------------------------------------

// nonce is a stateless challenge for a host id: its time and an HMAC binding
// both, valid for nonceTTL.
func (r *relay) nonce(hostID string, at time.Time) string {
	ts := strconv.FormatInt(at.Unix(), 10)
	return ts + "." + r.pairings.mac("shared-host-nonce", hostID+":"+ts)
}

func (r *relay) nonceValid(hostID, nonce string, now time.Time) bool {
	ts, _, ok := strings.Cut(nonce, ".")
	sec, err := strconv.ParseInt(ts, 10, 64)
	if !ok || err != nil {
		return false
	}
	at := time.Unix(sec, 0)
	if now.Before(at.Add(-time.Minute)) || now.After(at.Add(nonceTTL)) {
		return false
	}
	return hmac.Equal([]byte(nonce), []byte(r.nonce(hostID, at)))
}

// signedExchange is what the DSH's identity key signs: the nonce, the host
// and the server it is for, so a signature is good for one exchange only.
func signedExchange(nonce, hostID, appURL string) []byte {
	return []byte("dsh-teamwork shared host\n" + nonce + "\n" + hostID + "\n" + appURL)
}

func (r *relay) sharedChallenge(w http.ResponseWriter, req *http.Request) {
	var in struct {
		Key string `json:"key"`
	}
	if readJSON(req, &in) != nil || hostKeyID(in.Key) == "" {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]string{"nonce": r.nonce(hostKeyID(in.Key), now), "expiresAt": iso(now.Add(nonceTTL))})
}

func (r *relay) sharedToken(w http.ResponseWriter, req *http.Request) {
	var in struct {
		Key       string `json:"key"`
		PublicKey string `json:"publicKey"`
		Nonce     string `json:"nonce"`
		Signature string `json:"signature"`
	}
	refuse := func() { errorJSON(w, http.StatusUnauthorized, "host_key_invalid") }
	if readJSON(req, &in) != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	id := hostKeyID(in.Key)
	public, err1 := base64.StdEncoding.DecodeString(in.PublicKey)
	signature, err2 := base64.StdEncoding.DecodeString(in.Signature)
	if id == "" || err1 != nil || err2 != nil || len(public) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	ctx, now := req.Context(), time.Now().UTC()
	h, err := r.db.SharedHost.Get(ctx, id)
	if ent.IsNotFound(err) {
		refuse()
		return
	}
	if err != nil {
		slog.Error("relay: shared host", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
		return
	}
	if subtle.ConstantTimeCompare([]byte(h.KeyHash), []byte(r.pairings.mac("shared-host-key", in.Key))) != 1 {
		refuse()
		return
	}
	if !r.nonceValid(id, in.Nonce, now) || !ed25519.Verify(public, signedExchange(in.Nonce, id, r.host.AppURL), signature) {
		refuse()
		return
	}
	// The first exchange binds the machine; a race for it has one winner.
	if h.IdentityKey == nil {
		bound, err := r.db.SharedHost.Update().Where(sharedhost.ID(id), sharedhost.IdentityKeyIsNil()).
			SetIdentityKey(in.PublicKey).SetBoundAt(now).Save(ctx)
		if err != nil {
			slog.Error("relay: bind shared host", "error", err)
			errorJSON(w, http.StatusInternalServerError, "internal")
			return
		}
		if bound == 0 {
			if h, err = r.db.SharedHost.Get(ctx, id); err != nil {
				refuse()
				return
			}
		} else {
			k := in.PublicKey
			h.IdentityKey = &k
		}
	}
	if subtle.ConstantTimeCompare([]byte(*h.IdentityKey), []byte(in.PublicKey)) != 1 {
		errorJSON(w, http.StatusForbidden, "host_bound_elsewhere")
		return
	}
	token, expires, err := r.host.MintHostToken(ctx, id, h.TeamID, hostTokenTTL)
	if err != nil {
		slog.Error("relay: mint host token", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
		return
	}
	if err := r.db.SharedHost.UpdateOneID(id).SetLastSeenAt(now).Exec(ctx); err != nil {
		slog.Error("relay: shared host seen", "error", err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "expiresAt": iso(expires), "hostId": id, "teamId": h.TeamID, "name": h.Name})
}

// sharedTeamDeleted removes a deleted team's shared hosts, in the deletion's
// own transaction.
func (r *relay) sharedTeamDeleted(ctx context.Context, tx edition.SQLExecutor, change edition.TeamChange) error {
	if change.Kind != edition.TeamDeleted {
		return nil
	}
	c := borrowed(r.host.Dialect, tx)
	ids, err := c.SharedHost.Query().Where(sharedhost.TeamID(change.TeamID)).IDs(ctx)
	if err != nil {
		return err
	}
	if _, err := c.SharedHost.Delete().Where(sharedhost.IDIn(ids...)).Exec(ctx); err != nil {
		return err
	}
	// A shared DSH's archive outlives the host, and goes with the team.
	if _, err := c.SharedArchiveSegment.Delete().Where(sharedarchivesegment.TeamID(change.TeamID)).Exec(ctx); err != nil {
		return err
	}
	return deleteSharedRows(ctx, c, ids)
}

// deleteSharedRows removes what a deleted shared host leaves: its list and
// its pairings.
func deleteSharedRows(ctx context.Context, c *ent.Client, ids []string) error {
	if _, err := c.SharedHostMember.Delete().Where(sharedhostmember.HostIDIn(ids...)).Exec(ctx); err != nil {
		return err
	}
	_, err := c.RelayPairing.Delete().Where(relaypairing.HostIDIn(ids...)).Exec(ctx)
	return err
}

// dropHost closes a deleted shared host's socket and every phone's use of it.
func (r *relay) dropHost(hostID string) {
	r.mu.Lock()
	s := r.hosts[hostID]
	var pairings []string
	for id, a := range r.attached {
		if a.hostID == hostID {
			pairings = append(pairings, id)
			r.revoked[id] = true
		}
	}
	r.mu.Unlock()
	for _, id := range pairings {
		r.ended(hostID, id)
	}
	if s != nil {
		s.c.Close(closeUnauthorized, "shared host deleted")
	}
}
