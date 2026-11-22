package relay

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/net/publicsuffix"
)

const desktopWebCookie = "__Host-dsh-desktop"

type desktopWeb struct {
	domain   string
	mu       sync.Mutex
	hosts    map[string]*desktopWebHost
	tickets  map[string]desktopWebAccess
	sessions map[string]desktopWebAccess
	pending  map[string]chan net.Conn
}

type desktopWebHost struct {
	socket *socket
	user   string
	slots  chan struct{}
}

type desktopWebAccess struct {
	host    *desktopWebHost
	label   string
	expires time.Time
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
	site, err := url.Parse(r.host.AppURL)
	if err != nil {
		return err
	}
	appSite, appErr := publicsuffix.EffectiveTLDPlusOne(site.Hostname())
	webSite, webErr := publicsuffix.EffectiveTLDPlusOne(domain)
	if webErr != nil || (appErr == nil && webSite == appSite) {
		return errors.New("DESKTOP_WEB_DOMAIN must use a registrable domain separate from APP_URL")
	}
	d := &desktopWeb{
		domain: domain, hosts: make(map[string]*desktopWebHost), tickets: make(map[string]desktopWebAccess),
		sessions: make(map[string]desktopWebAccess), pending: make(map[string]chan net.Conn),
	}
	if err := r.host.ServeSubdomains(domain, http.HandlerFunc(r.serveDesktopWeb)); err != nil {
		return err
	}
	r.desktopWeb = d
	r.host.Mux.HandleFunc("POST /api/relay/hosts/{id}/web/ticket", r.desktopWebTicket)
	r.host.Mux.HandleFunc("GET /relay/web/tunnel", d.accept)
	return nil
}

func (d *desktopWeb) attach(id, user string, s *socket) func() {
	label := webLabel(id)
	host := &desktopWebHost{socket: s, user: user, slots: make(chan struct{}, 32)}
	d.mu.Lock()
	d.hosts[label] = host
	d.mu.Unlock()
	return func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.hosts[label] == host {
			delete(d.hosts, label)
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

func (d *desktopWeb) issue(entries map[string]desktopWebAccess, access desktopWebAccess) string {
	for id, entry := range entries {
		if time.Now().After(entry.expires) || entry.host.socket.ctx.Err() != nil {
			delete(entries, id)
		}
	}
	if len(entries) >= 8192 {
		return ""
	}
	id := webSecret()
	entries[id] = access
	return id
}

func (r *relay) desktopWebTicket(w http.ResponseWriter, req *http.Request) {
	user := r.caller(w, req)
	if user == "" {
		return
	}
	d := r.desktopWeb
	label := webLabel(req.PathValue("id"))
	d.mu.Lock()
	host := d.hosts[label]
	if host == nil || host.user != user || host.socket.ctx.Err() != nil {
		d.mu.Unlock()
		http.NotFound(w, req)
		return
	}
	token := d.issue(d.tickets, desktopWebAccess{host, label, time.Now().Add(time.Minute)})
	d.mu.Unlock()
	if token == "" {
		http.Error(w, "Too many pending web tickets", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"url": d.origin(label) + "/__dsh_desktop_enter?ticket=" + token})
}

func (d *desktopWeb) enter(w http.ResponseWriter, req *http.Request, label string) {
	if req.Method != http.MethodGet {
		http.NotFound(w, req)
		return
	}
	id := req.URL.Query().Get("ticket")
	d.mu.Lock()
	entry, ok := d.tickets[id]
	var session string
	if ok && entry.label == label && time.Now().Before(entry.expires) && d.hosts[label] == entry.host && entry.host.socket.ctx.Err() == nil {
		delete(d.tickets, id)
		entry.expires = time.Now().Add(8 * time.Hour)
		session = d.issue(d.sessions, entry)
	}
	d.mu.Unlock()
	if session == "" {
		http.NotFound(w, req)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: desktopWebCookie, Value: session, Path: "/", MaxAge: 8 * 60 * 60, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, req, "/", http.StatusSeeOther)
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
	if req.URL.Path == "/__dsh_desktop_enter" {
		d.enter(w, req, label)
		return
	}
	cookie, err := req.Cookie(desktopWebCookie)
	if err != nil {
		http.NotFound(w, req)
		return
	}
	d.mu.Lock()
	entry, ok := d.sessions[cookie.Value]
	allowed := ok && entry.label == label && time.Now().Before(entry.expires) && d.hosts[label] == entry.host
	d.mu.Unlock()
	if !allowed || entry.host.socket.ctx.Err() != nil {
		http.NotFound(w, req)
		return
	}
	token, _ := entry.host.socket.token.Load().(string)
	if owner, err := r.member(req.Context(), token); err != nil || owner != entry.host.user {
		http.NotFound(w, req)
		return
	}
	if (req.Method != http.MethodGet && req.Method != http.MethodHead || req.Header.Get("Upgrade") != "") &&
		req.Header.Get("Origin") != d.origin(label) {
		http.Error(w, "Invalid origin", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithDeadline(req.Context(), entry.expires)
	stop := context.AfterFunc(entry.host.socket.ctx, cancel)
	defer stop()
	defer cancel()
	proxy := httputil.ReverseProxy{
		Transport: &http.Transport{
			DisableKeepAlives:     true,
			ResponseHeaderTimeout: 60 * time.Second,
			DialContext:           func(ctx context.Context, _, _ string) (net.Conn, error) { return d.dial(ctx, entry.host) },
		},
		Rewrite: func(p *httputil.ProxyRequest) {
			p.Out.URL.Scheme, p.Out.URL.Host = "http", "desktop.invalid"
			p.Out.Host = "desktop.invalid"
			for _, name := range []string{"Cookie", "Authorization", "Referer"} {
				p.Out.Header.Del(name)
			}
			q := p.Out.URL.Query()
			q.Del("token")
			p.Out.URL.RawQuery = q.Encode()
		},
		ModifyResponse: func(res *http.Response) error {
			header := res.Header
			for _, name := range []string{"Set-Cookie", "Cache-Control", "Referrer-Policy", "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials"} {
				header.Del(name)
			}
			header.Add("Content-Security-Policy", "frame-ancestors 'none'")
			header.Set("Cross-Origin-Opener-Policy", "same-origin")
			return nil
		},
		FlushInterval: -1,
	}
	proxy.ServeHTTP(w, req.WithContext(ctx))
}

type desktopConn struct {
	net.Conn
	release func()
	once    sync.Once
}

func (c *desktopConn) Close() error {
	c.once.Do(c.release)
	return c.Conn.Close()
}

func (d *desktopWeb) dial(ctx context.Context, host *desktopWebHost) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	select {
	case host.slots <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-host.socket.ctx.Done():
		return nil, host.socket.ctx.Err()
	}
	id, delivery := webSecret(), make(chan net.Conn, 1)
	d.mu.Lock()
	d.pending[id] = delivery
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		delete(d.pending, id)
		d.mu.Unlock()
		select {
		case conn := <-delivery:
			conn.Close()
		default:
		}
	}()
	host.socket.send(map[string]string{"t": "webDial", "id": id})
	select {
	case conn := <-delivery:
		return &desktopConn{Conn: conn, release: func() { <-host.slots }}, nil
	case <-ctx.Done():
		<-host.slots
		return nil, ctx.Err()
	case <-host.socket.ctx.Done():
		<-host.slots
		return nil, host.socket.ctx.Err()
	}
}

func (d *desktopWeb) accept(w http.ResponseWriter, req *http.Request) {
	id := req.Header.Get("X-DSH-Web-Dial")
	d.mu.Lock()
	delivery := d.pending[id]
	d.mu.Unlock()
	if delivery == nil {
		http.NotFound(w, req)
		return
	}
	ws, err := websocket.Accept(w, req, nil)
	if err != nil {
		return
	}
	conn := websocket.NetConn(context.Background(), ws, websocket.MessageBinary)
	ws.SetReadLimit(1 << 20)
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.pending[id] == delivery {
		select {
		case delivery <- conn:
			delete(d.pending, id)
			return
		default:
		}
	}
	ws.CloseNow()
}
