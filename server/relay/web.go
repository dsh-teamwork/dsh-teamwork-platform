package relay

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
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
	domain  string
	mu      sync.Mutex
	hosts   map[string]*desktopWebHost
	cookies cipher.AEAD
	pending map[string]chan net.Conn
}

const (
	desktopWebTicketLimit = 8
	desktopWebTicketRate  = 30
)

type desktopWebHost struct {
	socket        *socket
	user          string
	generation    string
	slots         chan struct{}
	tickets       map[string]time.Time // guarded by desktopWeb.mu
	ticketWindow  time.Time
	ticketCount   int
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
	site, err := url.Parse(r.host.AppURL)
	if err != nil {
		return err
	}
	appSite, appErr := publicsuffix.EffectiveTLDPlusOne(site.Hostname())
	webSite, webErr := publicsuffix.EffectiveTLDPlusOne(domain)
	if webErr != nil || (appErr == nil && webSite == appSite) {
		return errors.New("DESKTOP_WEB_DOMAIN must use a registrable domain separate from APP_URL")
	}
	if cloudDomain := strings.ToLower(strings.Trim(r.host.Env("CLOUD_WEB_DOMAIN"), ".")); cloudDomain != "" {
		if cloudSite, err := publicsuffix.EffectiveTLDPlusOne(cloudDomain); err == nil && cloudSite == webSite {
			return errors.New("DESKTOP_WEB_DOMAIN must use a registrable domain separate from CLOUD_WEB_DOMAIN")
		}
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
		domain: domain, hosts: make(map[string]*desktopWebHost),
		cookies: cookies, pending: make(map[string]chan net.Conn),
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
	host := &desktopWebHost{socket: s, user: user, slots: make(chan struct{}, 32), generation: webSecret(), tickets: make(map[string]time.Time)}
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
func (h *desktopWebHost) issue(now time.Time) string {
	var oldest string
	for id, expiry := range h.tickets {
		if !now.Before(expiry) {
			delete(h.tickets, id)
		} else if oldest == "" || expiry.Before(h.tickets[oldest]) {
			oldest = id
		}
	}
	if len(h.tickets) >= desktopWebTicketLimit {
		delete(h.tickets, oldest)
	}
	id := webSecret()
	h.tickets[id] = now.Add(time.Minute)
	return id
}

func (d *desktopWeb) seal(host *desktopWebHost, label string, expiry time.Time) string {
	plain := binary.BigEndian.AppendUint64(nil, uint64(expiry.Unix()))
	return base64.RawURLEncoding.EncodeToString(d.cookies.Seal(nil, nil, plain, []byte(label+host.generation)))
}

func (d *desktopWeb) open(host *desktopWebHost, label, cookie string) (time.Time, bool) {
	sealed, err := base64.RawURLEncoding.DecodeString(cookie)
	if err != nil {
		return time.Time{}, false
	}
	plain, err := d.cookies.Open(nil, nil, sealed, []byte(label+host.generation))
	if err != nil || len(plain) != 8 {
		return time.Time{}, false
	}
	expiry := time.Unix(int64(binary.BigEndian.Uint64(plain)), 0)
	return expiry, time.Now().Before(expiry)
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
		errorJSON(w, http.StatusNotFound, "not_found")
		return
	}
	now := time.Now()
	if !host.takeTicket(now) {
		d.mu.Unlock()
		w.Header().Set("Retry-After", "60")
		errorJSON(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	token := host.issue(now)
	d.mu.Unlock()
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
	host := d.hosts[label]
	var session string
	now := time.Now()
	if host != nil && host.socket.ctx.Err() == nil {
		expiry := host.tickets[id]
		delete(host.tickets, id)
		if now.Before(expiry) {
			session = d.seal(host, label, now.Add(8*time.Hour))
		}
	}
	d.mu.Unlock()
	if session == "" {
		http.NotFound(w, req)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: desktopWebCookie, Value: session, Path: "/", MaxAge: 8 * 60 * 60, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	// A same-origin document starts a fresh navigation. A cross-site
	// redirect chain would carry cross-site Fetch Metadata to the homepage.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	io.WriteString(w, `<!doctype html><html><head><title>DSH Web</title><meta http-equiv="refresh" content="0;url=/"></head><body><a href="/">Open DSH Web</a></body></html>`)
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
	site := req.Header.Get("Sec-Fetch-Site")
	if site != "same-origin" && site != "none" {
		http.Error(w, "Invalid fetch site", http.StatusForbidden)
		return
	}
	if origin := req.Header.Get("Origin"); (origin != "" || req.Method != http.MethodGet && req.Method != http.MethodHead || req.Header.Get("Upgrade") != "") && origin != d.origin(label) {
		http.Error(w, "Invalid origin", http.StatusForbidden)
		return
	}
	d.mu.Lock()
	host := d.hosts[label]
	d.mu.Unlock()
	if host == nil || host.socket.ctx.Err() != nil {
		http.NotFound(w, req)
		return
	}
	expiry, ok := d.open(host, label, cookie.Value)
	if !ok {
		http.NotFound(w, req)
		return
	}
	allowed, err := host.admit(req.Context(), r)
	if err != nil {
		slog.Error("desktop web: member admission", "error", err)
		errorJSON(w, http.StatusInternalServerError, "internal")
		return
	}
	if !allowed {
		http.NotFound(w, req)
		return
	}
	ctx, cancel := context.WithDeadline(req.Context(), expiry)
	stop := context.AfterFunc(host.socket.ctx, cancel)
	defer stop()
	defer cancel()
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
