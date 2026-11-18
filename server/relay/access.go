package relay

// Who reaches a shared DSH (docs/tech/shared-dsh.md, "Two lists"). The relay
// keeps the server's list: a member of the shared host's team, and, when its
// access is "listed", named in shared_host_members. The DSH keeps its own
// roster of device keys and admits nobody this list does not; the relay sends
// it the list as `members` when it connects and whenever the list changes, so
// the DSH can drop whoever left.
//
//   - The DSH's plugin connects to /relay/plugin with its host token (ADR 0047);
//     the shared host's id is its relay host id.
//   - GET /relay/shared: the shared DSHs the caller may reach.
//   - POST /relay/shared/{hostId}/join: a pending pairing of the caller's handset
//     with a shared DSH, for the invite handshake the DSH then checks.
//   - PUT /api/teams/{teamId}/shared-hosts/{id}/members: a team admin's list.

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/auth"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedhost"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedhostmember"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
)

func (r *relay) accessRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /relay/shared", r.reachableShared)
	mux.HandleFunc("POST /relay/shared/{hostId}/join", r.joinShared)
	mux.HandleFunc("PUT /api/teams/{teamId}/shared-hosts/{id}/members", r.teamAdmin(r.setSharedMembers))
}

// sharedHostOf is the shared host a host token names, while that host still
// exists in the token's team; "" for any other token, and for every token
// while the relay mounts no shared DSHs.
func (r *relay) sharedHostOf(ctx context.Context, token string) (string, error) {
	if !r.teamDSH {
		return "", nil
	}
	claims, err := auth.NewSealer(r.host.AuthSecret, nil).Open(auth.HostBearer, token)
	if err != nil {
		return "", nil
	}
	ok, err := r.db.SharedHost.Query().Where(sharedhost.ID(claims.Sub), sharedhost.TeamID(claims.Team)).Exist(ctx)
	if err != nil || !ok {
		return "", err
	}
	return claims.Sub, nil
}

// canReach reports whether an account may reach a shared host: it is in the
// host's team and, for a listed host, on its list. ok is false for a host id
// that is no shared host.
func (r *relay) canReach(ctx context.Context, userID, hostID string) (shared, ok bool, err error) {
	h, err := r.db.SharedHost.Get(ctx, hostID)
	if ent.IsNotFound(err) {
		return false, false, nil
	}
	if err != nil {
		return true, false, err
	}
	if allowed, err := r.teamDSHAllowed(ctx, h.TeamID); err != nil || !allowed {
		return true, false, err
	}
	in, err := r.db.Membership.Query().Where(membership.UserID(userID), membership.TeamID(h.TeamID)).Exist(ctx)
	if err != nil || !in {
		return true, false, err
	}
	if h.Access == sharedhost.AccessTeam {
		return true, true, nil
	}
	listed, err := r.db.SharedHostMember.Query().Where(sharedhostmember.HostID(hostID), sharedhostmember.UserID(userID)).Exist(ctx)
	return true, listed, err
}

type memberView struct {
	UserID string  `json:"userId"`
	Email  *string `json:"email"`
	Name   *string `json:"name"`
}

// allowed is everyone who may reach a shared host now.
func (r *relay) allowed(ctx context.Context, h *ent.SharedHost) ([]memberView, error) {
	q := r.db.Membership.Query().Where(membership.TeamID(h.TeamID))
	if h.Access == sharedhost.AccessListed {
		ids, err := r.db.SharedHostMember.Query().Where(sharedhostmember.HostID(h.ID)).Select(sharedhostmember.FieldUserID).Strings(ctx)
		if err != nil {
			return nil, err
		}
		q.Where(membership.UserIDIn(ids...))
	}
	ids, err := q.Select(membership.FieldUserID).Strings(ctx)
	if err != nil {
		return nil, err
	}
	users, err := r.db.User.Query().Where(user.IDIn(ids...)).Order(ent.Asc(user.FieldEmail)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]memberView, 0, len(users))
	for _, u := range users {
		out = append(out, memberView{UserID: u.ID, Email: u.Email, Name: u.Name})
	}
	return out, nil
}

// tellMembers sends a connected shared host who may reach it, and cuts off
// every pairing of anyone else: their phones lose it at once, and the DSH
// drops them from its roster when it reads the list.
func (r *relay) tellMembers(ctx context.Context, hostID string) {
	h, err := r.db.SharedHost.Get(ctx, hostID)
	if err != nil {
		if !ent.IsNotFound(err) {
			slog.Error("relay: shared host", "error", err)
		}
		return
	}
	members, err := r.allowed(ctx, h)
	if err != nil {
		slog.Error("relay: shared host members", "error", err)
		return
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	gone, err := r.db.RelayPairing.Query().Where(relaypairing.HostID(hostID), relaypairing.RevokedAtIsNil(), relaypairing.UserIDNotIn(ids...)).IDs(ctx)
	if err != nil {
		slog.Error("relay: shared host pairings", "error", err)
		return
	}
	if len(gone) > 0 {
		if _, err := r.db.RelayPairing.Update().Where(relaypairing.IDIn(gone...)).SetRevokedAt(time.Now().UTC()).Save(ctx); err != nil {
			slog.Error("relay: revoke shared pairings", "error", err)
			return
		}
		for _, id := range gone {
			r.mu.Lock()
			r.revoked[id] = true
			r.mu.Unlock()
			r.ended(hostID, id)
		}
	}
	r.tell(hostID, map[string]any{"t": "members", "members": members})
}

// --- a member's routes -------------------------------------------------------

type reachableView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	TeamID   string `json:"teamId"`
	TeamName string `json:"teamName"`
	Online   bool   `json:"online"`
}

// reachableShared lists the shared DSHs the caller may reach, and which of
// their teams may not run one at all.
func (r *relay) reachableShared(w http.ResponseWriter, req *http.Request) {
	userID := r.caller(w, req)
	if userID == "" {
		return
	}
	ctx := req.Context()
	teams, err := r.db.Membership.Query().Where(membership.UserID(userID)).WithTeam().All(ctx)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	names := map[string]string{}
	teamIDs := make([]string, 0, len(teams))
	for _, m := range teams {
		names[m.TeamID] = m.Edges.Team.Name
		teamIDs = append(teamIDs, m.TeamID)
	}
	hosts, err := r.db.SharedHost.Query().Where(sharedhost.TeamIDIn(teamIDs...)).Order(ent.Asc(sharedhost.FieldCreatedAt), ent.Asc(sharedhost.FieldID)).All(ctx)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	// The caller's teams an edition keeps from running a Team DSH, so a member's console can say why there is none.
	unavailable := []string{}
	for _, id := range teamIDs {
		if ok, err := r.teamDSHAllowed(ctx, id); err != nil {
			rejectedJSON(w, err)
			return
		} else if !ok {
			unavailable = append(unavailable, id)
		}
	}
	out := []reachableView{}
	for _, h := range hosts {
		if _, ok, err := r.canReach(ctx, userID, h.ID); err != nil {
			rejectedJSON(w, err)
			return
		} else if !ok {
			continue
		}
		r.mu.Lock()
		online := r.hosts[h.ID] != nil
		r.mu.Unlock()
		out = append(out, reachableView{ID: h.ID, Name: h.Name, TeamID: h.TeamID, TeamName: names[h.TeamID], Online: online})
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": out, "unavailableTeamIds": unavailable})
}

// joinShared starts a handset's pairing with a shared DSH. It is pending until
// the DSH, having checked the member's invite inside the encrypted channel,
// confirms it; nothing but handshake records passes before.
func (r *relay) joinShared(w http.ResponseWriter, req *http.Request) {
	ph, ok := r.callerPhone(w, req)
	if !ok {
		return
	}
	if r.limited(ph.userID) {
		errorJSON(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	body, err := io.ReadAll(io.LimitReader(req.Body, maxBodyBytes+1))
	if err != nil || len(body) > maxBodyBytes {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	in, ok := parseJoin(body)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	ctx, hostID := req.Context(), req.PathValue("hostId")
	if _, reach, err := r.canReach(ctx, ph.userID, hostID); err != nil {
		rejectedJSON(w, err)
		return
	} else if !reach {
		errorJSON(w, http.StatusNotFound, string(errNotFound))
		return
	}
	h, err := r.db.SharedHost.Get(ctx, hostID)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	pairing, err := r.db.RelayPairing.Create().SetUserID(ph.userID).SetHostID(hostID).SetDeviceName(in).
		SetDeviceKeyHash(ph.deviceHash).SetCreatedAt(time.Now().UTC()).Save(ctx)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	paired := view(pairing, h.Name, nil)
	r.tell(hostID, map[string]any{"t": "paired", "pairing": paired})
	writeJSON(w, http.StatusCreated, map[string]any{"pairing": paired})
}

// --- the admin's list ----------------------------------------------------------

func (r *relay) setSharedMembers(w http.ResponseWriter, req *http.Request, userID, teamID string) error {
	var in struct {
		Access  string   `json:"access"`
		UserIDs []string `json:"userIds"`
	}
	if err := readJSON(req, &in); err != nil {
		return err
	}
	if (in.Access != "team" && in.Access != "listed") || len(in.UserIDs) > 1000 {
		return errInvalidInput
	}
	ctx := req.Context()
	h, err := r.sharedOf(ctx, teamID, req.PathValue("id"))
	if err != nil {
		return err
	}
	// Only the team's members can be listed.
	members, err := r.db.Membership.Query().Where(membership.TeamID(teamID), membership.UserIDIn(in.UserIDs...)).Select(membership.FieldUserID).Strings(ctx)
	if err != nil {
		return err
	}
	if len(members) != len(unique(in.UserIDs)) {
		return errInvalidInput
	}
	err = withTx(ctx, r.db, func(tx *ent.Tx) error {
		if _, err := tx.SharedHostMember.Delete().Where(sharedhostmember.HostID(h.ID)).Exec(ctx); err != nil {
			return err
		}
		for _, id := range members {
			if err := tx.SharedHostMember.Create().SetHostID(h.ID).SetUserID(id).SetAddedBy(userID).Exec(ctx); err != nil {
				return err
			}
		}
		return tx.SharedHost.UpdateOneID(h.ID).SetAccess(sharedhost.Access(in.Access)).Exec(ctx)
	})
	if err != nil {
		return err
	}
	r.tellMembers(ctx, h.ID)
	h, err = r.db.SharedHost.Get(ctx, h.ID)
	if err != nil {
		return err
	}
	view, err := r.sharedViewWithMembers(ctx, h)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"host": view})
	return nil
}

func unique(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// limited counts one pairing attempt by an account: ten in ten minutes.
func (r *relay) limited(userID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.attempts == nil {
		r.attempts = make(map[string]struct {
			at    time.Time
			count int
		})
	}
	now := time.Now()
	for id, previous := range r.attempts {
		if now.Sub(previous.at) >= 10*time.Minute {
			delete(r.attempts, id)
		}
	}
	attempt := r.attempts[userID]
	if attempt.count == 0 {
		attempt.at = now
	}
	attempt.count++
	r.attempts[userID] = attempt
	return attempt.count > 10
}
