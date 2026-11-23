package relay

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

func TestDesktopWebRelay(t *testing.T) {
	const domain = "desktop.example.test"
	editiontest.Each(t, []edition.Extension{Extension(30 * time.Second)}, editiontest.Options{
		Env: map[string]string{"DESKTOP_WEB_DOMAIN": domain},
	}, func(t *testing.T, in *editiontest.Instance) {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
		defer cancel()
		owner, other := in.Account("owner@example.test"), in.Account("other@example.test")
		in.Team(owner)
		in.Team(other)
		control, _, err := websocket.Dial(ctx, in.URL+"/relay/plugin", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer control.CloseNow()
		send := func(value obj) {
			t.Helper()
			data, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if err := control.Write(ctx, websocket.MessageText, data); err != nil {
				t.Fatal(err)
			}
		}
		read := func() obj {
			t.Helper()
			_, data, err := control.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var result obj
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatal(err)
			}
			return result
		}
		send(obj{"t": "hello", "clientId": "desktop-web-test", "name": "Desktop", "dshVersion": "0.2.2", "token": in.Bearer(owner), "web": true})
		hostID, ok := read()["hostId"].(string)
		if !ok {
			t.Fatal("host was not welcomed")
		}

		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		call := func(method, path, authority string, cookie *http.Cookie, token, origin string) *http.Response {
			t.Helper()
			req, err := http.NewRequestWithContext(ctx, method, in.URL+path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if authority != "" {
				req.Host = authority
				req.Header.Set("Sec-Fetch-Site", "same-origin")
				if origin == "https://sibling."+domain {
					req.Header.Set("Sec-Fetch-Site", "same-site")
				}
			}
			if cookie != nil {
				req.AddCookie(cookie)
			}
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			if origin != "" {
				req.Header.Set("Origin", origin)
			}
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { res.Body.Close() })
			return res
		}
		status := func(res *http.Response, want int) {
			t.Helper()
			if res.StatusCode != want {
				t.Fatalf("status %d, want %d", res.StatusCode, want)
			}
		}
		path := "/api/relay/hosts/" + hostID + "/web/ticket"
		status(call(http.MethodPost, path, "", nil, in.Bearer(other), ""), 404)
		status(call(http.MethodPost, path, "", in.Session(owner, "password"), "", "https://foreign.test"), 401)
		browser := call(http.MethodPost, path, "", in.Session(owner, "password"), "", in.URL)
		status(browser, 200)

		mobile := call(http.MethodPost, path, "", nil, in.Bearer(owner), "")
		status(mobile, 200)
		var address map[string]string
		if err := json.NewDecoder(mobile.Body).Decode(&address); err != nil {
			t.Fatal(err)
		}
		entry, err := url.Parse(address["url"])
		if err != nil || entry.Scheme != "https" || !strings.HasSuffix(entry.Host, "."+domain) {
			t.Fatalf("invalid entry URL: %v", err)
		}
		status(call(http.MethodGet, entry.RequestURI(), strings.Repeat("a", 40)+"."+domain, nil, "", ""), 404)
		session := call(http.MethodGet, entry.RequestURI(), entry.Host, nil, "", "")
		status(session, 200)
		cookies := session.Cookies()
		if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Domain != "" {
			t.Fatal("invalid browser cookie")
		}
		status(call(http.MethodGet, entry.RequestURI(), entry.Host, nil, "", ""), 404)
		status(call(http.MethodPost, "/api/session/list", entry.Host, cookies[0], "", "https://foreign.test"), 403)
		status(call(http.MethodGet, "/", entry.Host, cookies[0], "", "https://sibling."+domain), 403)
		missingSite, err := http.NewRequestWithContext(ctx, http.MethodGet, in.URL+"/", nil)
		if err != nil {
			t.Fatal(err)
		}
		missingSite.Host = entry.Host
		missingSite.AddCookie(cookies[0])
		missingSiteResponse, err := client.Do(missingSite)
		if err != nil {
			t.Fatal(err)
		}
		missingSiteResponse.Body.Close()
		status(missingSiteResponse, 403)

		altered := *cookies[0]
		altered.Value = "invalid"
		status(call(http.MethodGet, "/", entry.Host, &altered, "", ""), 404)

		type answer struct {
			body string
			code int
			err  error
		}
		result := make(chan answer, 1)
		go func() {
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, in.URL+"/?z=%20&a=1&a=2&to%6Ben=secret", nil)
			req.Host = entry.Host
			req.Header.Set("Sec-Fetch-Site", "same-origin")
			req.AddCookie(cookies[0])
			res, err := client.Do(req)
			if err != nil {
				result <- answer{err: err}
				return
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if res.Header.Get("Set-Cookie") != "" {
				result <- answer{code: -1}
				return
			}
			result <- answer{string(body), res.StatusCode, err}
		}()
		dial := read()
		if dial["t"] != "webDial" {
			t.Fatalf("unexpected frame %v", dial)
		}
		data, _, err := websocket.Dial(ctx, in.URL+"/relay/web/tunnel", &websocket.DialOptions{
			HTTPHeader: http.Header{"X-Dsh-Web-Dial": {dial["id"].(string)}},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer data.CloseNow()
		conn := websocket.NetConn(ctx, data, websocket.MessageBinary)
		upstream, err := http.ReadRequest(bufio.NewReader(conn))
		if err != nil {
			t.Fatal(err)
		}
		if upstream.URL.Path != "/" || upstream.URL.RawQuery != "z=%20&a=1&a=2" || upstream.Header.Get("Cookie") != "" {
			t.Fatal("browser credential reached upstream")
		}
		if _, err := io.WriteString(conn, "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nSet-Cookie: local=secret\r\n\r\nDSH!"); err != nil {
			t.Fatal(err)
		}
		select {
		case got := <-result:
			if got.err != nil || got.code != 200 || got.body != "DSH!" {
				t.Fatalf("proxy response: %+v", got)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		browserSocket := make(chan *websocket.Conn, 1)
		browserError := make(chan error, 1)
		go func() {
			ws, _, err := websocket.Dial(ctx, in.URL+"/api/remote.mux", &websocket.DialOptions{
				Host:       entry.Host, // As Chromium sends it: an Origin and no Fetch Metadata.
				HTTPHeader: http.Header{"Cookie": {cookies[0].String()}, "Origin": {entry.Scheme + "://" + entry.Host}},
			})
			if err != nil {
				browserError <- err
				return
			}
			browserSocket <- ws
		}()
		dial = read()
		upgraded, _, err := websocket.Dial(ctx, in.URL+"/relay/web/tunnel", &websocket.DialOptions{
			HTTPHeader: http.Header{"X-Dsh-Web-Dial": {dial["id"].(string)}},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer upgraded.CloseNow()
		wire := websocket.NetConn(ctx, upgraded, websocket.MessageBinary)
		reader := bufio.NewReader(wire)
		handshake, err := http.ReadRequest(reader)
		if err != nil {
			t.Fatal(err)
		}
		if handshake.URL.Path != "/api/remote.mux" || handshake.Header.Get("Upgrade") != "websocket" {
			t.Fatalf("unexpected upstream upgrade: %v", handshake)
		}
		// Complete the native application's WebSocket handshake, then pass one
		// frame in each direction through the nested tunnel.
		key := sha1.Sum([]byte(handshake.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		_, err = fmt.Fprintf(wire, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(key[:]))
		if err != nil {
			t.Fatal(err)
		}
		var browserWS *websocket.Conn
		select {
		case browserWS = <-browserSocket:
		case err := <-browserError:
			t.Fatal(err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		defer browserWS.CloseNow()
		if err := browserWS.Write(ctx, websocket.MessageText, []byte("x")); err != nil {
			t.Fatal(err)
		}
		var frame [7]byte
		if _, err := io.ReadFull(reader, frame[:]); err != nil || frame[0] != 0x81 || frame[1] != 0x81 || frame[2]^frame[6] != 'x' {
			t.Fatalf("bad browser frame %x: %v", frame, err)
		}
		if _, err := wire.Write([]byte{0x81, 1, 'y'}); err != nil {
			t.Fatal(err)
		}
		if _, msg, err := browserWS.Read(ctx); err != nil || string(msg) != "y" {
			t.Fatalf("bad upstream frame: %s, %v", msg, err)
		}
		control.CloseNow()
		if _, _, err := browserWS.Read(ctx); err == nil || ctx.Err() != nil {
			t.Fatalf("revocation did not close stream: %v", err)
		}
	})
}

func TestDesktopWebTicketQuotaIsPerHost(t *testing.T) {
	now := time.Now()
	first := &desktopWebHost{tickets: make(map[string]desktopWebTicket)}
	second := &desktopWebHost{tickets: make(map[string]desktopWebTicket)}
	original := first.issue(now, desktopWebTicket{})
	other := second.issue(now, desktopWebTicket{})
	for i := 1; i <= 8192; i++ {
		first.issue(now.Add(time.Duration(i)*time.Microsecond), desktopWebTicket{})
	}
	if len(first.tickets) != desktopWebTicketLimit || !first.tickets[original].expires.IsZero() {
		t.Fatal("abusive host did not evict its own oldest tickets")
	}
	if len(second.tickets) != 1 || second.tickets[other].expires.IsZero() {
		t.Fatal("one host exhausted another host's ticket quota")
	}
	for i := 0; i < desktopWebTicketRate; i++ {
		if !first.takeTicket(now) {
			t.Fatal("host limited early")
		}
	}
	if first.takeTicket(now) || !second.takeTicket(now) || !first.takeTicket(now.Add(time.Minute)) {
		t.Fatal("ticket issuance rate is not isolated or did not reset")
	}
}
