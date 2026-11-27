package relay

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

const desktopWebCookie = "__Host-dsh-desktop"

type desktopWeb struct {
	domain  string
	home    string // APP_URL, where the closed page leads
	mu      sync.Mutex
	hosts   map[string]*desktopWebHost
	cookies cipher.AEAD
	pending map[string]askedTunnel // webDial ids not yet answered
}

// askedTunnel is a webDial the computer has not answered yet: whose it is,
// when it was asked, and whether it is a spare.
type askedTunnel struct {
	host  *desktopWebHost
	at    time.Time
	spare bool
}

// spareTunnel is a data socket the computer opened that no request has taken
// yet. Every tunnel, asked for a request or as a spare, waits here, and a
// request takes the first fresh one.
type spareTunnel struct {
	conn net.Conn
	at   time.Time
}

const (
	// desktopWebSpares is how many tunnels a computer keeps open ahead of
	// requests once one is used: a page's assets each take a tunnel, and one
	// asked for only when needed costs a trip to the computer and a new
	// connection from it to the relay before any byte moves.
	desktopWebSpares = 4
	// desktopWebSpareFresh is how long a spare is used: the plugin closes a
	// tunnel that carried nothing for ten seconds.
	desktopWebSpareFresh = 8 * time.Second
	// desktopWebAskTimeout is how long an asked tunnel may take to come.
	desktopWebAskTimeout = 15 * time.Second
)

const (
	desktopWebTicketLimit = 8
	desktopWebTicketRate  = 30
	// desktopWebSessionLimit is how many sessions a computer keeps; one more
	// ends the one idle longest.
	desktopWebSessionLimit = 16
)

// How long a session lives with no byte moving, how long in all, and how
// often ended ones are swept (ADR 0065). Tests shorten them.
var (
	desktopWebIdle  = 30 * time.Minute
	desktopWebLife  = 8 * time.Hour
	desktopWebSweep = time.Minute
)

// desktopWebSession is one entry through a ticket: the client that entered,
// when, and when a byte last moved for it. Ending it cancels every request
// and WebSocket it has open.
type desktopWebSession struct {
	agent   [32]byte
	entered time.Time
	last    atomic.Int64 // unix nanoseconds
	ctx     context.Context
	end     context.CancelFunc
	// What the shell shows: the console's language when the ticket was
	// issued, and where "Back to Teamwork" goes.
	locale, back string
	// Bytes to and from the computer, for the bar's traffic.
	up, down atomic.Int64
}

// desktopWebTicket is a ticket not yet spent, and what its session will show.
type desktopWebTicket struct {
	expires      time.Time
	locale, back string
}

func agentOf(r *http.Request) [32]byte { return sha256.Sum256([]byte(r.UserAgent())) }

func (s *desktopWebSession) touch() { s.last.Store(time.Now().UnixNano()) }

func (s *desktopWebSession) live(now time.Time) bool {
	return now.Sub(time.Unix(0, s.last.Load())) < desktopWebIdle && now.Sub(s.entered) < desktopWebLife
}

// desktopWebSessionKey carries a request's session to the tunnel it dials.
type desktopWebSessionKey struct{}

type desktopWebHost struct {
	socket        *socket
	user          string
	name          atomic.Pointer[string] // the member may rename the computer while it is connected
	lastDial      atomic.Int64           // microseconds the last tunnel took to come up; 0 before any
	generation    string
	slots         chan struct{}               // one per tunnel asked for, waiting or in use
	tunnels       chan spareTunnel            // tunnels come and not yet taken
	asking        atomic.Int32                // spares asked for and not yet come
	tickets       map[string]desktopWebTicket // guarded by desktopWeb.mu
	ticketWindow  time.Time
	ticketCount   int
	sessions      map[string]*desktopWebSession // guarded by desktopWeb.mu
	admissionMu   sync.Mutex
	admittedUntil time.Time
}

func (h *desktopWebHost) admit(ctx context.Context, r *relay) (bool, error) {
	h.admissionMu.Lock()
	defer h.admissionMu.Unlock()
	if time.Now().Before(h.admittedUntil) {
		return true, nil
	}
	token, _ := h.socket.token.Load().(string)
	owner, err := r.member(ctx, token)
	if err != nil || owner != h.user {
		return false, err
	}
	h.admittedUntil = time.Now().Add(5 * time.Second)
	return true, nil
}

func webSecret() string {
	var data [32]byte
	rand.Read(data[:])
	return hex.EncodeToString(data[:])
}

func webLabel(id string) string {
	hash := sha256.Sum256([]byte(id))
	return hex.EncodeToString(hash[:20])
}

func (r *relay) mountDesktopWeb() error {
	domain := strings.ToLower(strings.Trim(r.host.Env("DESKTOP_WEB_DOMAIN"), "."))
	if domain == "" {
		return nil
	}
	var key [32]byte
	rand.Read(key[:])
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return err
	}
	cookies, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return err
	}
	d := &desktopWeb{
		domain: domain, home: strings.TrimSuffix(r.host.AppURL, "/") + "/", hosts: make(map[string]*desktopWebHost),
		cookies: cookies, pending: make(map[string]askedTunnel),
	}
	if err := r.host.ServeSubdomains(domain, http.HandlerFunc(r.serveDesktopWeb)); err != nil {
		return err
	}
	r.desktopWeb = d
	r.host.Mux.HandleFunc("POST /api/relay/hosts/{id}/web/ticket", r.desktopWebTicket)
	r.host.Mux.HandleFunc("GET /relay/web/tunnel", d.accept)
	go d.sweep(r.ctx)
	return nil
}

// revoke ends every native Web session of the computer hostID and every ticket
// not yet spent, at its owner's word (webRevoke): a new generation makes
// every cookie open nothing, and ending the sessions closes what they hold
// open. The computer's control connection, and its phones, stay.
func (d *desktopWeb) revoke(hostID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	host := d.hosts[webLabel(hostID)]
	if host == nil {
		return
	}
	host.generation = webSecret()
	for id, session := range host.sessions {
		session.end()
		delete(host.sessions, id)
	}
	clear(host.tickets)
	host.dropSpares()
}

// sweep ends every session past its idle or absolute limit, closing what it
// has open, until ctx ends.
func (d *desktopWeb) sweep(ctx context.Context) {
	tick := time.NewTicker(desktopWebSweep)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		now := time.Now()
		d.mu.Lock()
		for _, host := range d.hosts {
			for id, session := range host.sessions {
				if !session.live(now) {
					session.end()
					delete(host.sessions, id)
				}
			}
		}
		d.mu.Unlock()
	}
}

// rename shows a renamed computer's new name in the bars of its open sessions.
func (d *desktopWeb) rename(id, name string) {
	d.mu.Lock()
	host := d.hosts[webLabel(id)]
	d.mu.Unlock()
	if host != nil {
		host.name.Store(&name)
	}
}

func (d *desktopWeb) attach(id, user, name string, s *socket) func() {
	label := webLabel(id)
	host := &desktopWebHost{socket: s, user: user, slots: make(chan struct{}, 32), tunnels: make(chan spareTunnel, 32), generation: webSecret(), tickets: make(map[string]desktopWebTicket), sessions: make(map[string]*desktopWebSession)}
	host.name.Store(&name)
	d.mu.Lock()
	d.hosts[label] = host
	d.mu.Unlock()
	return func() {
		d.mu.Lock()
		if d.hosts[label] == host {
			delete(d.hosts, label)
		}
		d.mu.Unlock()
		host.dropSpares()
	}
}

// dropSpares closes the tunnels no request took.
func (h *desktopWebHost) dropSpares() {
	for {
		select {
		case t := <-h.tunnels:
			t.conn.Close()
			<-h.slots
		default:
			return
		}
	}
}

func (d *desktopWeb) online(id string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	h := d.hosts[webLabel(id)]
	return h != nil && h.socket.ctx.Err() == nil
}

func (d *desktopWeb) origin(label string) string { return "https://" + label + "." + d.domain }

// Every connected host has its own issuance budget.
func (h *desktopWebHost) takeTicket(now time.Time) bool {
	if !now.Before(h.ticketWindow) {
		h.ticketWindow = now.Add(time.Minute)
		h.ticketCount = 0
	}
	if h.ticketCount >= desktopWebTicketRate {
		return false
	}
	h.ticketCount++
	return true
}

// issue evicts only this host's oldest unspent ticket when its quota is full.
func (h *desktopWebHost) issue(now time.Time, ticket desktopWebTicket) string {
	var oldest string
	for id, t := range h.tickets {
		if !now.Before(t.expires) {
			delete(h.tickets, id)
		} else if oldest == "" || t.expires.Before(h.tickets[oldest].expires) {
			oldest = id
		}
	}
	if len(h.tickets) >= desktopWebTicketLimit {
		delete(h.tickets, oldest)
	}
	id := webSecret()
	ticket.expires = now.Add(time.Minute)
	h.tickets[id] = ticket
	return id
}

// seal is a session's cookie: its id, sealed to this computer's label and
// connection, so it opens nothing anywhere else or after a reconnect.
// The generation is read under d.mu, since webRevoke draws a new one.
func (d *desktopWeb) seal(generation, label, id string) string {
	return base64.RawURLEncoding.EncodeToString(d.cookies.Seal(nil, nil, []byte(id), []byte(label+generation)))
}

func (d *desktopWeb) open(generation, label, cookie string) (string, bool) {
	sealed, err := base64.RawURLEncoding.DecodeString(cookie)
	if err != nil {
		return "", false
	}
	plain, err := d.cookies.Open(nil, nil, sealed, []byte(label+generation))
	if err != nil {
		return "", false
	}
	return string(plain), true
}

// begin makes a session for the client of req, ending the one idle longest
// when the computer already keeps its limit. Called with d.mu held.
func (host *desktopWebHost) begin(req *http.Request, now time.Time, ticket desktopWebTicket) string {
	if len(host.sessions) >= desktopWebSessionLimit {
		var oldest string
		for id, session := range host.sessions {
			if oldest == "" || session.last.Load() < host.sessions[oldest].last.Load() {
				oldest = id
			}
		}
		host.sessions[oldest].end()
		delete(host.sessions, oldest)
	}
	ctx, end := context.WithCancel(host.socket.ctx)
	session := &desktopWebSession{agent: agentOf(req), entered: now, ctx: ctx, end: end, locale: ticket.locale, back: ticket.back}
	session.last.Store(now.UnixNano())
	id := webSecret()
	host.sessions[id] = session
	return id
}

// desktopWebReturn is a console page "Back to Teamwork" may lead to: the
// member's own My DSH, and nothing a ticket could turn into a redirect.
var desktopWebReturn = regexp.MustCompile(`^/teams/[A-Za-z0-9_-]{1,64}/my-dsh(/[A-Za-z0-9_-]{1,64})?$`)

func (r *relay) desktopWebTicket(w http.ResponseWriter, req *http.Request) {
	user := r.caller(w, req)
	if user == "" {
		return
	}
	var body struct {
		ReturnTo string `json:"returnTo"`
	}
	if req.ContentLength != 0 {
		if err := json.NewDecoder(io.LimitReader(req.Body, 4096)).Decode(&body); err != nil || body.ReturnTo != "" && !desktopWebReturn.MatchString(body.ReturnTo) {
			errorJSON(w, http.StatusBadRequest, "invalid_input")
			return
		}
	}
	// The phone app asks with its Bearer and goes back to itself, since its
	// in-app browser cannot be closed from the page; a browser goes back to
	// the console page it came from.
	back := strings.TrimSuffix(r.host.AppURL, "/") + "/"
	if bearer(req) != "" {
		back = "dshteamwork://"
	} else if body.ReturnTo != "" {
		back = strings.TrimSuffix(r.host.AppURL, "/") + body.ReturnTo
	}
	profile := ""
	if account, err := r.db.User.Get(req.Context(), user); err == nil && account.Locale != nil {
		profile = *account.Locale
	}
	ticket := desktopWebTicket{locale: web.ViewerLocale(req, profile), back: back}
	d := r.desktopWeb
	label := webLabel(req.PathValue("id"))
	d.mu.Lock()
	host := d.hosts[label]
	if host == nil || host.user != user || host.socket.ctx.Err() != nil {
		d.mu.Unlock()
		errorJSON(w, http.StatusNotFound, "not_found")
		return
	}
	now := time.Now()
	if !host.takeTicket(now) {
		d.mu.Unlock()
		w.Header().Set("Retry-After", "60")
		errorJSON(w, http.StatusTooManyRequests, wire.TooManyAttempts)
		return
	}
	token := host.issue(now, ticket)
	d.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"url": d.origin(label) + desktopWebEnter + "?ticket=" + token})
}

func (d *desktopWeb) enter(w http.ResponseWriter, req *http.Request, label string) {
	if req.Method != http.MethodGet {
		d.closed(w, req)
		return
	}
	id := req.URL.Query().Get("ticket")
	d.mu.Lock()
	host := d.hosts[label]
	var session string
	now := time.Now()
	if host != nil && host.socket.ctx.Err() == nil {
		ticket, ok := host.tickets[id]
		delete(host.tickets, id)
		if ok && now.Before(ticket.expires) {
			session = d.seal(host.generation, label, host.begin(req, now, ticket))
		}
	}
	d.mu.Unlock()
	if session == "" {
		d.closed(w, req)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: desktopWebCookie, Value: session, Path: "/", MaxAge: int(desktopWebLife / time.Second), Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	// A same-origin document starts a fresh navigation, into the shell. A
	// cross-site redirect chain would carry cross-site Fetch Metadata to it.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.WriteString(w, `<!doctype html><html><head><title>DSH</title><meta http-equiv="refresh" content="0;url=`+desktopWebShell+`"></head><body><a href="`+desktopWebShell+`">DSH</a></body></html>`)
}

// session is the live session req belongs to, or nil once it has written why
// not: no cookie or one that opens nothing, a request from another page, a
// computer gone, a client other than the one that entered, a session past
// its limits, or an owner no longer the computer's.
func (r *relay) session(w http.ResponseWriter, req *http.Request, label string) (*desktopWebHost, *desktopWebSession) {
	d := r.desktopWeb
	cookie, err := req.Cookie(desktopWebCookie)
	if err != nil {
		d.closed(w, req)
		return nil, nil
	}
	if !edition.FromOwnPages(req, d.origin(label)) {
		http.Error(w, "Cross-origin request refused", http.StatusForbidden)
		return nil, nil
	}
	d.mu.Lock()
	host := d.hosts[label]
	var generation string
	if host != nil {
		generation = host.generation
	}
	d.mu.Unlock()
	if host == nil || host.socket.ctx.Err() != nil {
		d.closed(w, req)
		return nil, nil
	}
	id, ok := d.open(generation, label, cookie.Value)
	if !ok {
		d.closed(w, req)
		return nil, nil
	}
	now := time.Now()
	d.mu.Lock()
	session := host.sessions[id]
	if session != nil && (session.agent != agentOf(req) || !session.live(now)) {
		session.end()
		delete(host.sessions, id)
		session = nil
	}
	d.mu.Unlock()
	if session == nil {
		d.closed(w, req)
		return nil, nil
	}
	allowed, err := host.admit(req.Context(), r)
	if err != nil {
		slog.Error("desktop web: member admission", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
		return nil, nil
	}
	if !allowed {
		d.closed(w, req)
		return nil, nil
	}
	return host, session
}

func (r *relay) serveDesktopWeb(w http.ResponseWriter, req *http.Request) {
	d := r.desktopWeb
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	label, ok := strings.CutSuffix(strings.ToLower(req.Host), "."+d.domain)
	if !ok || len(label) != 40 {
		http.NotFound(w, req)
		return
	}
	if req.URL.Path == desktopWebEnter {
		d.enter(w, req, label)
		return
	}
	host, session := r.session(w, req, label)
	if session == nil {
		return
	}
	if strings.HasPrefix(req.URL.Path, desktopWebShell) {
		d.shell(w, req, host, session)
		return
	}
	// A page opened at the top, by the address bar or a DSH link to a new
	// window, lands in a shell; DSH itself is only ever the shell's frame.
	if req.Header.Get("Sec-Fetch-Dest") == "document" {
		http.Redirect(w, req, desktopWebShell+"?path="+url.QueryEscape(req.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	session.touch()
	ctx, cancel := context.WithDeadline(req.Context(), session.entered.Add(desktopWebLife))
	stop := context.AfterFunc(session.ctx, cancel)
	defer stop()
	defer cancel()
	// The shell frames DSH, so its pages may be framed by their own origin
	// alone, whatever DSH itself says.
	w.Header().Del("X-Frame-Options")
	proxy := httputil.ReverseProxy{
		Transport: &http.Transport{
			DisableKeepAlives:     true,
			ResponseHeaderTimeout: 60 * time.Second,
			DialContext:           func(ctx context.Context, _, _ string) (net.Conn, error) { return d.dial(ctx, host) },
		},
		Rewrite: func(p *httputil.ProxyRequest) {
			p.Out.URL.Scheme, p.Out.URL.Host = "http", "desktop.invalid"
			p.Out.Host = "desktop.invalid"
			for _, name := range []string{"Cookie", "Authorization", "Referer"} {
				p.Out.Header.Del(name)
			}
			p.Out.URL.RawQuery = desktopWebQuery(p.In.URL.RawQuery)
		},
		ModifyResponse: func(res *http.Response) error {
			header := res.Header
			for _, name := range []string{"Set-Cookie", "Cache-Control", "Referrer-Policy", "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "X-Frame-Options"} {
				header.Del(name)
			}
			withoutFrameAncestors(header)
			header.Add("Content-Security-Policy", "frame-ancestors 'self'")
			header.Set("Cross-Origin-Opener-Policy", "same-origin")
			return nil
		},
		FlushInterval: -1,
	}
	proxy.ServeHTTP(w, req.WithContext(context.WithValue(ctx, desktopWebSessionKey{}, session)))
}

// withoutFrameAncestors drops DSH's own frame-ancestors from its policies, so
// the gateway's is the one that applies; every other directive stays.
func withoutFrameAncestors(header http.Header) {
	policies := header.Values("Content-Security-Policy")
	header.Del("Content-Security-Policy")
	for _, policy := range policies {
		var kept []string
		for _, directive := range strings.Split(policy, ";") {
			if name, _, _ := strings.Cut(strings.TrimSpace(directive), " "); !strings.EqualFold(name, "frame-ancestors") && strings.TrimSpace(directive) != "" {
				kept = append(kept, strings.TrimSpace(directive))
			}
		}
		if len(kept) > 0 {
			header.Add("Content-Security-Policy", strings.Join(kept, "; "))
		}
	}
}

// Preserve ordering, encoding and duplicate values while removing launch tokens.
func desktopWebQuery(raw string) string {
	parts := strings.Split(raw, "&")
	kept := parts[:0]
	for _, part := range parts {
		key, _, _ := strings.Cut(part, "=")
		if decoded, _ := url.QueryUnescape(key); decoded != "token" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, "&")
}

// desktopConn is one tunnel to the computer: it frees its slot once closed,
// and every byte through it is activity for the session that dialed it.
type desktopConn struct {
	net.Conn
	release func()
	once    sync.Once
	session *desktopWebSession
}

func (c *desktopConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 && c.session != nil {
		c.session.touch()
		c.session.down.Add(int64(n))
	}
	return n, err
}

func (c *desktopConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	if n > 0 && c.session != nil {
		c.session.touch()
		c.session.up.Add(int64(n))
	}
	return n, err
}

func (c *desktopConn) Close() error {
	c.once.Do(c.release)
	return c.Conn.Close()
}

func (d *desktopWeb) dial(ctx context.Context, host *desktopWebHost) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, desktopWebAskTimeout)
	defer cancel()
	session, _ := ctx.Value(desktopWebSessionKey{}).(*desktopWebSession)
	taken := func(conn net.Conn) net.Conn {
		// A tunnel in use: keep the next ones coming before they are needed.
		go d.refill(host)
		return &desktopConn{Conn: conn, release: func() { <-host.slots }, session: session}
	}
	if conn := host.fresh(); conn != nil {
		return taken(conn), nil
	}
	select {
	case host.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-host.socket.ctx.Done():
		return nil, host.socket.ctx.Err()
	}
	d.ask(host, false)
	for {
		select {
		case t := <-host.tunnels:
			if time.Since(t.at) < desktopWebSpareFresh {
				return taken(t.conn), nil
			}
			t.conn.Close()
			<-host.slots
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-host.socket.ctx.Done():
			return nil, host.socket.ctx.Err()
		}
	}
}

// fresh takes a tunnel that came and is still fresh, closing stale ones on
// the way, or nil when none waits.
func (h *desktopWebHost) fresh() net.Conn {
	for {
		select {
		case t := <-h.tunnels:
			if time.Since(t.at) < desktopWebSpareFresh {
				return t.conn
			}
			t.conn.Close()
			<-h.slots
		default:
			return nil
		}
	}
}

// refill asks for spares until desktopWebSpares are come or coming, as far as
// the computer's slots allow.
func (d *desktopWeb) refill(host *desktopWebHost) {
	for len(host.tunnels)+int(host.asking.Load()) < desktopWebSpares {
		select {
		case host.slots <- struct{}{}:
		default:
			return
		}
		host.asking.Add(1)
		d.ask(host, true)
	}
}

// ask sends the computer one webDial, its slot already held; the tunnel
// comes to host.tunnels (accept), or the slot is freed when it does not
// come in time.
func (d *desktopWeb) ask(host *desktopWebHost, spare bool) {
	id := webSecret()
	d.mu.Lock()
	d.pending[id] = askedTunnel{host: host, at: time.Now(), spare: spare}
	d.mu.Unlock()
	host.socket.send(map[string]string{"t": "webDial", "id": id})
	time.AfterFunc(desktopWebAskTimeout, func() {
		d.mu.Lock()
		_, waiting := d.pending[id]
		delete(d.pending, id)
		d.mu.Unlock()
		if waiting {
			if spare {
				host.asking.Add(-1)
			}
			<-host.slots
		}
	})
}

// deliver puts a tunnel the computer opened for id where requests take them.
func (d *desktopWeb) deliver(id string, conn net.Conn) bool {
	d.mu.Lock()
	asked, ok := d.pending[id]
	delete(d.pending, id)
	d.mu.Unlock()
	if !ok {
		return false
	}
	host := asked.host
	if asked.spare {
		host.asking.Add(-1)
	}
	host.lastDial.Store(max(time.Since(asked.at).Microseconds(), 1))
	select {
	case host.tunnels <- spareTunnel{conn: conn, at: time.Now()}:
	default:
		conn.Close()
		<-host.slots
	}
	return true
}

func (d *desktopWeb) accept(w http.ResponseWriter, req *http.Request) {
	id := req.Header.Get("X-DSH-Web-Dial")
	d.mu.Lock()
	_, ok := d.pending[id]
	d.mu.Unlock()
	if !ok {
		http.NotFound(w, req)
		return
	}
	ws, err := websocket.Accept(w, req, nil)
	if err != nil {
		return
	}
	ws.SetReadLimit(1 << 20)
	if !d.deliver(id, websocket.NetConn(context.Background(), ws, websocket.MessageBinary)) {
		ws.CloseNow()
	}
}
