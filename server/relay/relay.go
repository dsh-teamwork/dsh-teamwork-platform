// Package relay is the relay (docs/tech/relay.md, ADR 0044), which every
// binary's main imports, served under /relay on the server's own port:
//
//   - /relay/plugin (WebSocket): a member's DSH connects out, proves who it
//     is in its first frame and is recorded as a host. It then asks for
//     pairing codes, lists, confirms and revokes its phones, and hears when a
//     phone redeemed a code or a pairing ended.
//   - POST /relay/pair, GET /relay/pairings, DELETE /relay/pairings/{id}
//     (HTTP, with the app's Bearer and handset credential): a phone redeems a code, lists its
//     pairings, revokes one. The web console, by its session cookie, lists
//     the member's own computers with every device paired to them (GET
//     /relay/hosts) and may revoke any of those pairings (ADR 0048).
//   - /relay/phone (WebSocket): a phone proves who it is in its first frame,
//     then sends opaque sealed frames naming a pairing. The relay passes each
//     to that pairing's host and the host's answers back. It reads only the
//     envelope; the plugin decides what may run (ADR 0009).
//   - GET /api/relay names the plugin socket, from which the plugin and the
//     app find the rest. The community edition has no relay and answers 404.
//
// A phone socket takes a pairing over with its first frame for it, once the
// database says the pairing matches both its account and handset credential; the desktop authenticates
// and locally authorizes its cryptographic identity. From then on
// frames of that pairing go to and from that socket without another query.
// Revoking the pairing, the host leaving and the phone leaving each end that.
package relay

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relayhost"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairingoffer"
)

// Every binary mounts the relay (ADR 0044): its main imports this package,
// which registers it with notifications through Expo and a ping every thirty
// seconds.
func init() { edition.Register(Extension(throughExpo, 30*time.Second)) }

// Extension is the relay with its push sender and ping interval; tests pass
// their own. It mounts through edition.Host like a closed extension does, and
// its tables are the open schema's, migrated with the rest.
func Extension(push SendPush, pingEvery time.Duration) edition.Extension {
	return edition.Extension{
		// Not "relay": the hosted edition's own migrations are recorded under
		// that name, from when its relay carried them (ADR 0044).
		Name: "open-relay",
		Mount: func(h edition.Host) (func(), error) {
			if h.ServiceRole == "manage" {
				return nil, nil
			}
			r := newRelay(h, push, pingEvery)
			if err := h.SubscribeTeams(r.teamChanged); err != nil {
				return nil, err
			}
			r.routes(h.Mux)
			r.sharedRoutes(h.Mux)
			r.accessRoutes(h.Mux)
			r.archiveRoutes(h.Mux)
			return r.close, nil
		},
	}
}

type relay struct {
	db        *ent.Client
	pairings  *pairings
	push      *notifier
	host      edition.Host
	pingEvery time.Duration
	ctx       context.Context // ends when the server shuts down
	cancel    context.CancelFunc

	handlers sync.WaitGroup // one per open socket, until its handler returns

	mu       sync.Mutex
	hosts    map[string]*socket     // connected hosts, by host id
	attached map[string]*attachment // pairings a phone socket is using, by pairing id
	revoked  map[string]bool        // pairings revoked since this process started
	attempts map[string]struct {
		at    time.Time
		count int
	}
	sockets map[*socket]struct{} // every open socket, closed at shutdown
}

// attachment is a pairing a phone socket took over: where its frames go, and
// how many the phone sent lately.
type attachment struct {
	phone       *socket
	hostID      string
	windowStart time.Time
	sent        int
}

func newRelay(h edition.Host, push SendPush, pingEvery time.Duration) *relay {
	client := clientOf(h)
	ctx, cancel := context.WithCancel(context.Background())
	return &relay{
		db: client, pairings: &pairings{db: client, secret: h.AuthSecret},
		push: &notifier{db: client, send: push, last: map[string]time.Time{}},
		host: h, pingEvery: pingEvery, ctx: ctx, cancel: cancel,
		hosts: map[string]*socket{}, attached: map[string]*attachment{}, revoked: map[string]bool{}, sockets: map[*socket]struct{}{},
	}
}

func (r *relay) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/relay", r.discover)
	mux.HandleFunc("GET /relay/plugin", r.acceptPlugin)
	mux.HandleFunc("GET /relay/phone", r.acceptPhone)
	mux.HandleFunc("POST /relay/pair", r.pair)
	mux.HandleFunc("GET /relay/pairings", r.listPairings)
	mux.HandleFunc("GET /relay/hosts", r.listHosts)
	mux.HandleFunc("DELETE /relay/pairings/{id}", r.revokePairing)
	mux.HandleFunc("PUT /relay/pairings/{id}/push", r.setPush)
}

// close ends every socket, the server going away, and returns once their
// handlers have finished what they write on the way out.
func (r *relay) close() {
	r.cancel()
	r.mu.Lock()
	all := make([]*socket, 0, len(r.sockets))
	for s := range r.sockets {
		all = append(all, s)
	}
	r.mu.Unlock()
	for _, s := range all {
		s.c.CloseNow()
	}
	r.handlers.Wait()
}

// member is the account a token names, checked on every HTTP request, at a
// socket's hello, and again at each of its pings, so a member who leaves
// every team, or whose token expires, loses an open socket within one ping
// interval; "" for anyone else. A person in any team may pair a phone: the
// relay reaches their own computer, whichever teams they are in.
func (r *relay) member(ctx context.Context, token string) (string, error) {
	who, err := r.host.Bearer(ctx, token)
	if err != nil || who == nil {
		return "", err
	}
	in, err := r.host.Users.InTeam(ctx, who.UserID)
	if err != nil || !in {
		return "", err
	}
	return who.UserID, nil
}

// browserMember is member for a browser: the account its session cookie
// names, if it is in any team.
func (r *relay) browserMember(req *http.Request) (string, error) {
	who, err := r.host.Session(req)
	if err != nil || who == nil {
		return "", err
	}
	in, err := r.host.Users.InTeam(req.Context(), who.UserID)
	if err != nil || !in {
		return "", err
	}
	return who.UserID, nil
}

// fromSite is whether a socket's upgrade came from a page of this site: the
// one way a browser's session cookie may admit it, so a page elsewhere cannot
// ride a member's cookie (an upgrade carries cookies but no CORS check).
func (r *relay) fromSite(req *http.Request) bool {
	origin := req.Header.Get("Origin")
	return origin != "" && origin == r.host.AppURL
}

// --- sockets ---------------------------------------------------------------

type socket struct {
	c   *websocket.Conn
	ctx context.Context
	// token is what the socket proved itself with, once its hello passed.
	token atomic.Value // string
	// cookie is a browser's upgrade request, kept to re-open its session at
	// each ping, when that, not a token, admitted it.
	cookie atomic.Value // *http.Request
}

// send writes one frame; a socket that cannot take it is closing anyway.
func (s *socket) send(v any) {
	if s == nil {
		return
	}
	b, err := json.Marshal(v)
	if err != nil {
		slog.Error("relay: frame", "error", err)
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()
	s.c.Write(ctx, websocket.MessageText, b)
}

// accept upgrades the request from any origin: a socket proves who it is in
// its first frame, and only a page of this site may lean on its session
// cookie instead (acceptPhone, fromSite).
func (r *relay) accept(w http.ResponseWriter, req *http.Request) (*socket, func()) {
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return nil, nil
	}
	c.SetReadLimit(maxFrameBytes)
	r.handlers.Add(1)
	ctx, cancel := context.WithCancel(r.ctx)
	s := &socket{c: c, ctx: ctx}
	r.mu.Lock()
	r.sockets[s] = struct{}{}
	r.mu.Unlock()
	go r.keepAlive(s)
	return s, func() {
		cancel()
		c.CloseNow()
		r.mu.Lock()
		delete(r.sockets, s)
		r.mu.Unlock()
		r.handlers.Done()
	}
}

// keepAlive pings a socket and drops it when a ping goes unanswered, and
// closes it once its token no longer names a member.
func (r *relay) keepAlive(s *socket) {
	t := time.NewTicker(r.pingEvery)
	defer t.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-t.C:
			ctx, cancel := context.WithTimeout(s.ctx, r.pingEvery)
			err := s.c.Ping(ctx)
			cancel()
			if err != nil {
				s.c.CloseNow()
				return
			}
			if token, _ := s.token.Load().(string); token != "" && !r.stillAdmitted(s, token) {
				s.c.Close(closeUnauthorized, "not a member")
				return
			}
			if browser, _ := s.cookie.Load().(*http.Request); browser != nil && !r.stillAdmitted(s, "") {
				s.c.Close(closeUnauthorized, "not a member")
				return
			}
		}
	}
}

// stillAdmitted re-checks a socket at its ping: a member's token must still
// name a member, and a phone's uses of shared DSHs must still be allowed; a
// shared DSH's token must still name its shared host, whose list it is sent
// again, so its roster follows a member leaving the team.
func (r *relay) stillAdmitted(s *socket, token string) bool {
	var id string
	var err error
	if browser, _ := s.cookie.Load().(*http.Request); token == "" && browser != nil {
		if id, err = r.browserMember(browser.WithContext(s.ctx)); err == nil && id == "" {
			return false
		}
	} else {
		id, err = r.member(s.ctx, token)
	}
	if err != nil {
		return true
	}
	if id == "" {
		shared, err := r.sharedHostOf(s.ctx, token)
		if err != nil || shared == "" {
			return err != nil
		}
		r.tellMembers(s.ctx, shared)
		return true
	}
	r.mu.Lock()
	var held []struct{ pairing, host string }
	for pairingID, a := range r.attached {
		if a.phone == s {
			held = append(held, struct{ pairing, host string }{pairingID, a.hostID})
		}
	}
	r.mu.Unlock()
	for _, h := range held {
		if shared, ok, err := r.canReach(s.ctx, id, h.host); err == nil && shared && !ok {
			r.mu.Lock()
			delete(r.attached, h.pairing)
			r.mu.Unlock()
			s.send(map[string]string{"t": "revoked", "pairingId": h.pairing})
			r.tell(h.host, map[string]string{"t": "detach", "pairingId": h.pairing})
		}
	}
	return true
}

// readHello reads a socket's first frame, closing it with 4400 when none
// comes in time. A timer rather than a deadline on the read: the library
// drops the connection outright when a read's context expires, and the
// client would see no close code to act on.
func readHello(s *socket) ([]byte, bool) {
	late := time.AfterFunc(helloTimeout, func() { s.c.Close(closeBadHello, "no hello") })
	_, data, err := s.c.Read(s.ctx)
	return data, late.Stop() && err == nil
}

// --- the plugin's socket ---------------------------------------------------

func (r *relay) acceptPlugin(w http.ResponseWriter, req *http.Request) {
	s, done := r.accept(w, req)
	if s == nil {
		return
	}
	defer done()
	data, ok := readHello(s)
	if !ok {
		return
	}
	h, ok := parseHello(data)
	if !ok {
		s.c.Close(closeBadHello, "bad hello")
		return
	}
	userID, err := r.member(s.ctx, h.token)
	sharedID := ""
	if err == nil && userID == "" {
		// A shared DSH (ADR 0044) proves itself with its host token instead.
		sharedID, err = r.sharedHostOf(s.ctx, h.token)
	}
	if err != nil {
		slog.Error("relay: member", "error", err)
		s.c.Close(websocket.StatusInternalError, "internal")
		return
	}
	if userID == "" && sharedID == "" {
		s.c.Close(closeUnauthorized, "not a member")
		return
	}
	hostID := sharedID
	if sharedID == "" {
		hostID, err = r.recordHost(s.ctx, userID, h)
		if err != nil {
			slog.Error("relay: record host", "error", err)
			s.c.Close(websocket.StatusInternalError, "internal")
			return
		}
	}
	r.mu.Lock()
	stale := r.hosts[hostID]
	r.hosts[hostID] = s
	r.mu.Unlock()
	if stale != nil {
		// Its close handshake waits on a peer that may be gone; the new
		// socket's welcome does not.
		go stale.c.Close(closeReplaced, "replaced")
	}
	s.token.Store(h.token)
	s.send(map[string]string{"t": "welcome", "hostId": hostID})
	defer r.hostLeft(hostID, s)
	if sharedID != "" {
		r.tellMembers(s.ctx, sharedID)
	}

	for {
		_, data, err := s.c.Read(s.ctx)
		if err != nil {
			return
		}
		f, ok := parse(data)
		if !ok {
			continue
		}
		if fw, ok := parseHostFrame(f); ok {
			r.toPhone(hostID, fw)
		} else if wt, ok := parseWaiting(f); ok {
			go r.notify(hostID, wt)
		} else if request, ok := parsePluginRequest(f); ok {
			if sharedID != "" && request.t == "offer" {
				// A pairing code joins a phone to its owner's own computer; a
				// shared DSH's members join by invite.
				s.send(reply{T: "reply", ID: request.id, Error: "shared_host"})
				continue
			}
			go func() { s.send(r.answer(hostID, request)) }()
		}
	}
}

// recordHost is the host for this member's computer, created on its first
// connection and refreshed on each after.
func (r *relay) recordHost(ctx context.Context, userID string, h hello) (string, error) {
	now := time.Now().UTC()
	for try := 0; ; try++ {
		existing, err := r.db.RelayHost.Query().Where(relayhost.UserID(userID), relayhost.ClientID(h.clientID)).Only(ctx)
		if err == nil {
			return existing.ID, r.db.RelayHost.UpdateOne(existing).SetName(h.name).SetDshVersion(h.dshVersion).SetLastSeenAt(now).Exec(ctx)
		}
		if !ent.IsNotFound(err) {
			return "", err
		}
		created, err := r.db.RelayHost.Create().SetUserID(userID).SetClientID(h.clientID).SetName(h.name).
			SetDshVersion(h.dshVersion).SetLastSeenAt(now).SetCreatedAt(now).Save(ctx)
		// Two sockets of one computer racing: the loser reads the winner's row.
		if ent.IsConstraintError(err) && try == 0 {
			continue
		}
		if err != nil {
			return "", err
		}
		return created.ID, nil
	}
}

// hostLeft forgets a host's socket, unless a newer one replaced it: every
// phone using it hears the computer went away.
func (r *relay) hostLeft(hostID string, s *socket) {
	r.mu.Lock()
	if r.hosts[hostID] != s {
		r.mu.Unlock()
		return
	}
	delete(r.hosts, hostID)
	type offline struct {
		phone     *socket
		pairingID string
	}
	var told []offline
	for id, a := range r.attached {
		if a.hostID == hostID {
			delete(r.attached, id)
			told = append(told, offline{a.phone, id})
		}
	}
	r.mu.Unlock()
	for _, o := range told {
		o.phone.send(map[string]string{"t": "offline", "pairingId": o.pairingID})
	}
	if err := r.db.RelayHost.UpdateOneID(hostID).SetLastSeenAt(time.Now().UTC()).Exec(context.Background()); err != nil && !ent.IsNotFound(err) {
		slog.Error("relay: could not record a host leaving", "error", err)
	}
}

func (r *relay) tell(hostID string, event any) {
	r.mu.Lock()
	s := r.hosts[hostID]
	r.mu.Unlock()
	s.send(event)
}

// toPhone passes a host's answer to the phone using that pairing, and only if
// the pairing is this host's.
func (r *relay) toPhone(hostID string, f forwarded) {
	r.mu.Lock()
	a := r.attached[f.PairingID]
	r.mu.Unlock()
	if a != nil && a.hostID == hostID {
		a.phone.send(f)
	}
}

func (r *relay) notify(hostID string, w waiting) {
	connected := func(pairingID string) bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		a := r.attached[pairingID]
		return a != nil && a.hostID == hostID
	}
	if err := r.push.notify(r.ctx, hostID, w, connected, time.Now()); err != nil {
		slog.Error("relay: could not send a push notification", "error", err)
	}
}

// ended is a pairing ending: its host hears it, and so does the phone using
// it, which loses it at once.
func (r *relay) ended(hostID, pairingID string) {
	r.mu.Lock()
	r.revoked[pairingID] = true
	a := r.attached[pairingID]
	delete(r.attached, pairingID)
	r.mu.Unlock()
	r.tell(hostID, map[string]string{"t": "revoked", "pairingId": pairingID})
	if a != nil {
		a.phone.send(map[string]string{"t": "revoked", "pairingId": pairingID})
	}
}

type reply struct {
	T     string `json:"t"`
	ID    string `json:"id"`
	Value any    `json:"value,omitempty"`
	Error string `json:"error,omitempty"`
}

func (r *relay) answer(hostID string, q pluginRequest) reply {
	ctx, now := r.ctx, time.Now().UTC()
	out := reply{T: "reply", ID: q.id}
	var err error
	switch q.t {
	case "offer":
		out.Value, err = r.pairings.offer(ctx, hostID, now)
	case "pairings":
		var list []pairingView
		list, err = r.pairings.list(ctx, host(hostID))
		if list == nil {
			list = []pairingView{}
		}
		out.Value = list
	case "decide":
		err = r.pairings.decide(ctx, hostID, q.pairingID, q.accept, now)
		if err == nil && !q.accept {
			r.mu.Lock()
			r.revoked[q.pairingID] = true
			r.mu.Unlock()
		}
	case "revoke":
		if _, err = r.pairings.revoke(ctx, host(hostID), q.pairingID, now); err == nil {
			r.ended(hostID, q.pairingID)
		}
	}
	var rej rejected
	switch {
	case errors.As(err, &rej):
		out.Value, out.Error = nil, string(rej)
	case err != nil:
		slog.Error("relay: plugin request failed", "request", q.t, "error", err)
		out.Value, out.Error = nil, "internal"
	case out.Value == nil:
		// decide and revoke answer `value: null`, as the plugin expects.
		return reply{T: "reply", ID: q.id, Value: json.RawMessage("null")}
	}
	return out
}

// --- the phone's socket ----------------------------------------------------

func (r *relay) acceptPhone(w http.ResponseWriter, req *http.Request) {
	// A browser on this site proves who it is by its session cookie and
	// sends no token; anything else proves it in its hello.
	browser := req.Clone(context.Background())
	s, done := r.accept(w, req)
	if s == nil {
		return
	}
	defer done()
	data, ok := readHello(s)
	if !ok {
		return
	}
	hello, ok := parsePhoneHello(data)
	if !ok {
		s.c.Close(closeBadHello, "bad hello")
		return
	}
	var userID string
	var err error
	if hello.token != "" {
		userID, err = r.member(s.ctx, hello.token)
	} else if r.fromSite(browser) {
		userID, err = r.browserMember(browser.WithContext(s.ctx))
	}
	if err != nil {
		slog.Error("relay: member", "error", err)
		s.c.Close(websocket.StatusInternalError, "internal")
		return
	}
	if userID == "" {
		s.c.Close(closeUnauthorized, "not a member")
		return
	}
	if hello.token != "" {
		s.token.Store(hello.token)
	} else {
		s.cookie.Store(browser)
	}
	ph := phone{userID: userID, deviceHash: r.pairings.deviceHash(hello.deviceKey)}
	s.send(map[string]string{"t": "welcome"})
	defer r.phoneLeft(s)

	// One frame at a time, so a pairing's first frame is checked before its
	// second is passed on.
	for {
		_, data, err := s.c.Read(s.ctx)
		if err != nil {
			return
		}
		f, ok := parse(data)
		if !ok {
			continue
		}
		if fw, ok := parsePhoneFrame(f); ok {
			if err := r.forward(ph, s, fw); err != nil {
				slog.Error("relay: could not forward a phone frame", "error", err)
			}
		}
	}
}

func (r *relay) forward(ph phone, s *socket, f forwarded) error {
	refuse := func(why string) error {
		event := map[string]string{"t": "error", "pairingId": f.PairingID, "error": why}
		s.send(event)
		return nil
	}
	r.mu.Lock()
	a := r.attached[f.PairingID]
	r.mu.Unlock()
	if a == nil || a.phone != s {
		hostID, err := r.pairings.use(s.ctx, ph, f.PairingID, time.Now().UTC())
		if errors.Is(err, errNotFound) {
			return refuse("not_paired")
		}
		if err != nil {
			return err
		}
		if shared, ok, err := r.canReach(s.ctx, ph.userID, hostID); err != nil {
			return err
		} else if shared && !ok {
			return refuse("not_paired")
		}
		r.mu.Lock()
		if r.revoked[f.PairingID] {
			r.mu.Unlock()
			return refuse("not_paired")
		}
		previous := r.attached[f.PairingID]
		a = &attachment{phone: s, hostID: hostID, windowStart: time.Now()}
		r.attached[f.PairingID] = a
		r.mu.Unlock()
		// Another socket of this same handset held it: that one is told, and the
		// host closes what it had opened.
		if previous != nil && previous.phone != s {
			previous.phone.send(map[string]string{"t": "detached", "pairingId": f.PairingID})
			r.tell(previous.hostID, map[string]string{"t": "detach", "pairingId": f.PairingID})
		}
	}
	r.mu.Lock()
	host := r.hosts[a.hostID]
	now := time.Now()
	if now.Sub(a.windowStart) >= rateWindow {
		a.windowStart, a.sent = now, 0
	}
	a.sent++
	limited := a.sent > rateLimit
	r.mu.Unlock()
	if host == nil {
		return refuse("offline")
	}
	if limited {
		return refuse("rate_limited")
	}
	host.send(f)
	return nil
}

// phoneLeft releases every pairing the phone held: each host closes what
// that phone opened.
func (r *relay) phoneLeft(s *socket) {
	type detach struct{ hostID, pairingID string }
	var told []detach
	r.mu.Lock()
	for id, a := range r.attached {
		if a.phone == s {
			delete(r.attached, id)
			told = append(told, detach{a.hostID, id})
		}
	}
	r.mu.Unlock()
	for _, d := range told {
		r.tell(d.hostID, map[string]string{"t": "detach", "pairingId": d.pairingID})
	}
}

// --- HTTP ------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func errorJSON(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

// discover names the plugin's socket: APP_URL with a WebSocket scheme.
func (r *relay) discover(w http.ResponseWriter, _ *http.Request) {
	url := r.host.AppURL
	if rest, ok := strings.CutPrefix(url, "https://"); ok {
		url = "wss://" + rest
	} else if rest, ok := strings.CutPrefix(url, "http://"); ok {
		url = "ws://" + rest
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url + "/relay/plugin"})
}

// bearer is a request's Bearer token, or "" when it sends none, as the web
// console does.
func bearer(req *http.Request) string {
	token, _ := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer ")
	return strings.TrimSpace(token)
}

// caller is the member a request's Bearer names, or, without one, the
// browser session's member (a write only from this site); "" after answering
// 401.
func (r *relay) caller(w http.ResponseWriter, req *http.Request) string {
	var userID string
	var err error
	if token := bearer(req); token != "" {
		userID, err = r.member(req.Context(), token)
	} else if req.Method == http.MethodGet || r.host.SameOrigin(req) {
		userID, err = r.browserMember(req)
	}
	if err != nil {
		slog.Error("relay: member", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
		return ""
	}
	if userID == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
	}
	return userID
}

// The relay sees this admission credential, never the separate E2EE identity seed.
func (r *relay) callerPhone(w http.ResponseWriter, req *http.Request) (phone, bool) {
	userID := r.caller(w, req)
	if userID == "" {
		return phone{}, false
	}
	key := req.Header.Get("X-Device-Key")
	if !validDeviceKey(key) {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return phone{}, false
	}
	return phone{userID: userID, deviceHash: r.pairings.deviceHash(key)}, true
}

func rejectedJSON(w http.ResponseWriter, err error) {
	var rej rejected
	switch {
	case errors.As(err, &rej) && rej == errNotFound:
		errorJSON(w, http.StatusNotFound, string(rej))
	case errors.As(err, &rej):
		errorJSON(w, http.StatusBadRequest, string(rej))
	default:
		slog.Error("relay: request failed", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
	}
}

func (r *relay) pair(w http.ResponseWriter, req *http.Request) {
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
	in, ok := parseRedeem(body)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	paired, err := r.pairings.redeem(req.Context(), ph, in, time.Now().UTC())
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	r.tell(paired.HostID, map[string]any{"t": "paired", "pairing": paired})
	writeJSON(w, http.StatusCreated, map[string]any{"pairing": paired})
}

func (r *relay) listPairings(w http.ResponseWriter, req *http.Request) {
	ph, ok := r.callerPhone(w, req)
	if !ok {
		return
	}
	list, err := r.pairings.list(req.Context(), ph)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	r.mu.Lock()
	for i := range list {
		_, online := r.hosts[list[i].HostID]
		list[i].Online = &online
	}
	r.mu.Unlock()
	if list == nil {
		list = []pairingView{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"pairings": list})
}

// hostView is one of the member's own computers on the web console's list,
// with every device of theirs paired to it.
type hostView struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	DSHVersion string           `json:"dshVersion"`
	Online     bool             `json:"online"`
	LastSeenAt string           `json:"lastSeenAt"`
	Pairings   []hostDeviceView `json:"pairings"`
}

type hostDeviceView struct {
	ID         string  `json:"id"`
	DeviceName string  `json:"deviceName"`
	Status     string  `json:"status"` // pending or confirmed
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt"`
	Push       bool    `json:"push"`
	// Current is the pairing of the handset asking: this browser.
	Current bool `json:"current"`
}

// listHosts is the member's own computers, most recently seen first, each
// with every live pairing of theirs to it (ADR 0048). Only the web console
// asks, by its session cookie; an app's Bearer is refused, as a phone keeps
// to its own handset (the hosted edition's ADR 0020).
func (r *relay) listHosts(w http.ResponseWriter, req *http.Request) {
	if bearer(req) != "" {
		errorJSON(w, http.StatusForbidden, "forbidden")
		return
	}
	userID := r.caller(w, req)
	if userID == "" {
		return
	}
	ctx := req.Context()
	hosts, err := r.db.RelayHost.Query().Where(relayhost.UserID(userID)).
		Order(ent.Desc(relayhost.FieldLastSeenAt), ent.Desc(relayhost.FieldID)).All(ctx)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	ids := make([]string, len(hosts))
	for i, h := range hosts {
		ids[i] = h.ID
	}
	rows, err := r.db.RelayPairing.Query().Where(relaypairing.RevokedAtIsNil(), account{userID: userID, hostIDs: ids}.where()).
		Order(ent.Desc(relaypairing.FieldCreatedAt), ent.Desc(relaypairing.FieldID)).All(ctx)
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	// This browser's own pairings are marked by its handset credential, when it sends one.
	var mine string
	if key := req.Header.Get("X-Device-Key"); validDeviceKey(key) {
		mine = r.pairings.deviceHash(key)
	}
	devices := map[string][]hostDeviceView{}
	for _, p := range rows {
		v := view(p, "")
		devices[p.HostID] = append(devices[p.HostID], hostDeviceView{
			ID: v.ID, DeviceName: v.DeviceName, Status: v.Status, CreatedAt: v.CreatedAt, LastUsedAt: v.LastUsedAt,
			Push: p.PushToken != nil, Current: mine != "" && p.DeviceKeyHash != nil && *p.DeviceKeyHash == mine,
		})
	}
	out := make([]hostView, len(hosts))
	r.mu.Lock()
	for i, h := range hosts {
		_, online := r.hosts[h.ID]
		out[i] = hostView{ID: h.ID, Name: h.Name, DSHVersion: h.DshVersion, Online: online, LastSeenAt: iso(h.LastSeenAt), Pairings: devices[h.ID]}
		if out[i].Pairings == nil {
			out[i].Pairings = []hostDeviceView{}
		}
	}
	r.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"hosts": out})
}

func (r *relay) setPush(w http.ResponseWriter, req *http.Request) {
	ph, ok := r.callerPhone(w, req)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(req.Body, maxBodyBytes+1))
	if err != nil || len(body) > maxBodyBytes {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	in, ok := parsePushUpdate(body)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input")
		return
	}
	if err := r.pairings.setPush(req.Context(), ph, req.PathValue("id"), in); err != nil {
		rejectedJSON(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// revokePairing ends a pairing. An app's Bearer reaches only its own
// handset's; the web console's session reaches every pairing of the member to
// their own computers (ADR 0048), so a lost phone is cut off from the browser.
func (r *relay) revokePairing(w http.ResponseWriter, req *http.Request) {
	var s scope
	if bearer(req) == "" {
		userID := r.caller(w, req)
		if userID == "" {
			return
		}
		own, err := r.db.RelayHost.Query().Where(relayhost.UserID(userID)).IDs(req.Context())
		if err != nil {
			rejectedJSON(w, err)
			return
		}
		s = account{userID: userID, hostIDs: own}
	} else {
		ph, ok := r.callerPhone(w, req)
		if !ok {
			return
		}
		s = ph
	}
	id := req.PathValue("id")
	hostID, err := r.pairings.revoke(req.Context(), s, id, time.Now().UTC())
	if err != nil {
		rejectedJSON(w, err)
		return
	}
	r.ended(hostID, id)
	w.WriteHeader(http.StatusNoContent)
}

// teamChanged is the relay's one subscription to team changes.
func (r *relay) teamChanged(ctx context.Context, tx edition.SQLExecutor, change edition.TeamChange) error {
	if err := r.sharedTeamDeleted(ctx, tx, change); err != nil {
		return err
	}
	return r.accountDeleted(ctx, tx, change)
}

// accountDeleted removes a deleted account's computers, their pairing codes
// and its phones' pairings (docs/adr/0039-deleting-an-account.md), in the
// deletion's own transaction. A socket still open closes at its next ping,
// when its token no longer opens.
func (r *relay) accountDeleted(ctx context.Context, tx edition.SQLExecutor, change edition.TeamChange) error {
	if change.Kind != edition.AccountDeleted {
		return nil
	}
	c := borrowed(r.host.Dialect, tx)
	hosts, err := c.RelayHost.Query().Where(relayhost.UserID(change.UserID)).IDs(ctx)
	if err != nil {
		return err
	}
	if _, err := c.RelayPairing.Delete().Where(relaypairing.Or(relaypairing.UserID(change.UserID), relaypairing.HostIDIn(hosts...))).Exec(ctx); err != nil {
		return err
	}
	if _, err := c.RelayPairingOffer.Delete().Where(relaypairingoffer.HostIDIn(hosts...)).Exec(ctx); err != nil {
		return err
	}
	_, err = c.RelayHost.Delete().Where(relayhost.UserID(change.UserID)).Exec(ctx)
	return err
}
