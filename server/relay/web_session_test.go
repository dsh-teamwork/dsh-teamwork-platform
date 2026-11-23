package relay

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

// desktopWebComputer connects a computer that offers native Web and answers
// every tunnel the gateway asks for with answer, a raw HTTP response ("ok"
// when empty); it returns the computer's id, and ask, which sends the
// gateway a request of kind t over the computer's control connection and
// returns its reply.
func desktopWebComputer(t *testing.T, ctx context.Context, in *editiontest.Instance, token, answer string) (string, func(t string) obj) {
	if answer == "" {
		answer = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"
	}
	t.Helper()
	control, _, err := websocket.Dial(ctx, in.URL+"/relay/plugin", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { control.CloseNow() })
	hello, _ := json.Marshal(obj{"t": "hello", "clientId": "session-test", "name": "Desktop", "dshVersion": "0.2.2", "token": token, "web": true})
	if err := control.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	welcome := make(chan string, 1)
	replies := make(chan obj, 8)
	go func() {
		for {
			_, data, err := control.Read(ctx)
			if err != nil {
				return
			}
			var frame obj
			json.Unmarshal(data, &frame)
			switch frame["t"] {
			case "welcome":
				welcome <- frame["hostId"].(string)
			case "reply":
				replies <- frame
			case "webDial":
				go func(id string) {
					tunnel, _, err := websocket.Dial(ctx, in.URL+"/relay/web/tunnel", &websocket.DialOptions{HTTPHeader: http.Header{"X-Dsh-Web-Dial": {id}}})
					if err != nil {
						return
					}
					defer tunnel.CloseNow()
					conn := websocket.NetConn(ctx, tunnel, websocket.MessageBinary)
					if _, err := http.ReadRequest(bufio.NewReader(conn)); err != nil {
						return
					}
					io.WriteString(conn, answer)
					conn.Close()
				}(frame["id"].(string))
			}
		}
	}()
	ask := func(kind string) obj {
		t.Helper()
		request, _ := json.Marshal(obj{"t": kind, "id": kind + "-1"})
		if err := control.Write(ctx, websocket.MessageText, request); err != nil {
			t.Fatal(err)
		}
		select {
		case reply := <-replies:
			return reply
		case <-ctx.Done():
			t.Fatalf("no reply to %s", kind)
			return nil
		}
	}
	select {
	case id := <-welcome:
		return id, ask
	case <-ctx.Done():
		t.Fatal("the computer was not welcomed")
		return "", nil
	}
}

// A session lives while bytes move for it, for its client alone, never past
// its absolute limit, and among at most desktopWebSessionLimit on a computer
// (ADR 0065).
func TestDesktopWebSessions(t *testing.T) {
	const domain = "desktop.example.test"
	idle, life := desktopWebIdle, desktopWebLife
	t.Cleanup(func() { desktopWebIdle, desktopWebLife = idle, life })
	editiontest.Each(t, []edition.Extension{Extension(30 * time.Second)}, editiontest.Options{
		Env: map[string]string{"DESKTOP_WEB_DOMAIN": domain},
	}, func(t *testing.T, in *editiontest.Instance) {
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		defer cancel()
		owner := in.Account("owner@example.test")
		in.Team(owner)
		hostID, ask := desktopWebComputer(t, ctx, in, in.Bearer(owner), "")
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		do := func(path, authority, agent string, cookie *http.Cookie) int {
			t.Helper()
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, in.URL+path, nil)
			req.Host = authority
			req.Header.Set("Sec-Fetch-Site", "same-origin")
			req.Header.Set("User-Agent", agent)
			if cookie != nil {
				req.AddCookie(cookie)
			}
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			return res.StatusCode
		}
		// enter spends a fresh ticket as agent and returns the computer's host and the session's cookie.
		enter := func(agent string) (string, *http.Cookie) {
			t.Helper()
			req, _ := http.NewRequestWithContext(ctx, http.MethodPost, in.URL+"/api/relay/hosts/"+hostID+"/web/ticket", nil)
			req.Header.Set("Authorization", "Bearer "+in.Bearer(owner))
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var ticket struct{ URL string }
			json.NewDecoder(res.Body).Decode(&ticket)
			res.Body.Close()
			entry, err := url.Parse(ticket.URL)
			if err != nil || res.StatusCode != 200 {
				t.Fatalf("ticket: %d", res.StatusCode)
			}
			req, _ = http.NewRequestWithContext(ctx, http.MethodGet, in.URL+entry.RequestURI(), nil)
			req.Host = entry.Host
			req.Header.Set("Sec-Fetch-Site", "cross-site")
			req.Header.Set("User-Agent", agent)
			res, err = client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 200 || len(res.Cookies()) != 1 {
				t.Fatalf("enter: %d", res.StatusCode)
			}
			return entry.Host, res.Cookies()[0]
		}
		desktopWebIdle, desktopWebLife = 400*time.Millisecond, time.Hour

		// Requests that keep coming keep it, past the idle limit in all; a pause past it ends it.
		host, cookie := enter("browser")
		for range 4 {
			if code := do("/", host, "browser", cookie); code != 200 {
				t.Fatalf("an active session: %d", code)
			}
			time.Sleep(200 * time.Millisecond)
		}
		time.Sleep(500 * time.Millisecond)
		if code := do("/", host, "browser", cookie); code != 404 {
			t.Fatalf("after idling past the limit: %d", code)
		}

		// Another client with the same cookie ends it, for the client that entered too.
		host, cookie = enter("browser")
		if code := do("/", host, "elsewhere", cookie); code != 404 {
			t.Fatalf("another client: %d", code)
		}
		if code := do("/", host, "browser", cookie); code != 404 {
			t.Fatalf("the session a copied cookie was used from: %d", code)
		}

		// Traffic never extends it past its absolute limit.
		desktopWebLife = 700 * time.Millisecond
		host, cookie = enter("browser")
		for range 3 {
			if code := do("/", host, "browser", cookie); code != 200 {
				t.Fatalf("within its life: %d", code)
			}
			time.Sleep(250 * time.Millisecond)
		}
		if code := do("/", host, "browser", cookie); code != 404 {
			t.Fatalf("past its life: %d", code)
		}

		// One entry past the limit ends the session idle longest, and only that one.
		desktopWebIdle, desktopWebLife = time.Hour, time.Hour
		cookies := make([]*http.Cookie, 0, desktopWebSessionLimit+1)
		for range desktopWebSessionLimit {
			host, cookie = enter("browser")
			cookies = append(cookies, cookie)
		}
		if code := do("/", host, "browser", cookies[1]); code != 200 {
			t.Fatalf("a recent session: %d", code)
		}
		_, cookie = enter("browser")
		cookies = append(cookies, cookie)
		if code := do("/", host, "browser", cookies[0]); code != 404 {
			t.Fatalf("the session idle longest after one more entry: %d", code)
		}
		for i, c := range cookies[1:] {
			if code := do("/", host, "browser", c); code != 200 {
				t.Fatalf("session %d after one more entry: %d", i+1, code)
			}
		}

		// The computer's word ends every session and every unspent ticket, and keeps its control connection.
		unspent, err := http.NewRequestWithContext(ctx, http.MethodPost, in.URL+"/api/relay/hosts/"+hostID+"/web/ticket", nil)
		if err != nil {
			t.Fatal(err)
		}
		unspent.Header.Set("Authorization", "Bearer "+in.Bearer(owner))
		res, err := client.Do(unspent)
		if err != nil {
			t.Fatal(err)
		}
		var waiting struct{ URL string }
		json.NewDecoder(res.Body).Decode(&waiting)
		res.Body.Close()
		if reply := ask("webRevoke"); reply["id"] != "webRevoke-1" || reply["value"] != nil || reply["error"] != nil {
			t.Fatalf("webRevoke replied %v", reply)
		}
		for i, c := range cookies[1:] {
			if code := do("/", host, "browser", c); code != 404 {
				t.Fatalf("session %d after webRevoke: %d", i+1, code)
			}
		}
		stale, _ := url.Parse(waiting.URL)
		if code := do(stale.RequestURI(), stale.Host, "browser", nil); code != 404 {
			t.Fatalf("a ticket issued before webRevoke: %d", code)
		}
		if reply := ask("pairings"); reply["error"] != nil {
			t.Fatalf("the control connection after webRevoke: %v", reply)
		}
		host, cookie = enter("browser")
		if code := do("/", host, "browser", cookie); code != 200 {
			t.Fatalf("a fresh entry after webRevoke: %d", code)
		}
	})
}
