//go:build e2e

package e2e

// Native Web on a personal computer (docs/tech/relay.md): this test is the
// browser, web.mjs the computer, with the plugin's own relay client and
// connector in front of a stand-in for DSH's loopback Web server. It pins the
// wire the two repositories share: the webDial frame, the data socket the
// plugin dials back, what reaches DSH, and that a reconnect ends access.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/relay"
)

// seen is what the stand-in DSH reports of a request it was given.
type seen struct {
	Method, URL, Host, Cookie, Origin, Authorization, Referer string
}

func TestPluginNativeWeb(t *testing.T) {
	plugin := os.Getenv("DSH_TEAMWORK_PLUGIN")
	if plugin == "" {
		plugin = filepath.Join(here(), "..", "..", "..", "dsh-teamwork")
	}
	if _, err := os.Stat(filepath.Join(plugin, "lib", "web-relay.js")); err != nil {
		t.Fatalf("the DSH plugin at %s has no native Web connector (set DSH_TEAMWORK_PLUGIN): %v", plugin, err)
	}
	const domain = "d.example.test"
	ext := relay.Extension(time.Minute)
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{Env: map[string]string{"DESKTOP_WEB_DOMAIN": domain}}, func(t *testing.T, in *editiontest.Instance) {
		ada := in.Account("ada@example.test")
		in.Team(ada)
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, "node", filepath.Join(here(), "web.mjs"))
		cmd.Env = append(os.Environ(), "BASE="+in.URL, "TOKEN="+in.Bearer(ada), "PLUGIN="+plugin)
		stdin, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		exited := false
		defer func() {
			if !exited {
				cmd.Process.Kill()
				cmd.Wait()
			}
			if t.Failed() {
				t.Logf("web.mjs:\n%s", stderr.String())
			}
		}()
		lines := bufio.NewScanner(stdout)
		connected := func() string {
			t.Helper()
			if !lines.Scan() {
				t.Fatalf("the computer did not connect: %v", lines.Err())
			}
			var line struct{ Host string }
			if err := json.Unmarshal(lines.Bytes(), &line); err != nil || line.Host == "" {
				t.Fatalf("the computer said %q", lines.Text())
			}
			return line.Host
		}
		host := connected()

		// The owner's own list offers the entry once the computer has said it may.
		var listed struct {
			Hosts []struct {
				ID        string
				WebOnline bool
			}
		}
		res := request(t, ctx, http.MethodGet, in.URL+"/relay/hosts", "", nil, http.Header{"Cookie": {in.Session(ada, "password").String()}})
		json.NewDecoder(res.Body).Decode(&listed)
		res.Body.Close()
		if len(listed.Hosts) != 1 || listed.Hosts[0].ID != host || !listed.Hosts[0].WebOnline {
			t.Fatalf("hosts %+v", listed.Hosts)
		}

		enter := func() (string, *http.Cookie) {
			t.Helper()
			res := request(t, ctx, http.MethodPost, in.URL+"/api/relay/hosts/"+host+"/web/ticket", "", nil, http.Header{"Authorization": {"Bearer " + in.Bearer(ada)}})
			var ticket struct{ URL string }
			json.NewDecoder(res.Body).Decode(&ticket)
			res.Body.Close()
			entry, err := url.Parse(ticket.URL)
			if res.StatusCode != 200 || err != nil || !strings.HasSuffix(entry.Host, "."+domain) {
				t.Fatalf("ticket: %d %q", res.StatusCode, ticket.URL)
			}
			// Opened from the platform's pages, another site.
			res = request(t, ctx, http.MethodGet, in.URL+entry.RequestURI(), entry.Host, nil, http.Header{"Sec-Fetch-Site": {"cross-site"}})
			res.Body.Close()
			cookies := res.Cookies()
			if res.StatusCode != 200 || len(cookies) != 1 {
				t.Fatalf("enter: %d, %d cookies", res.StatusCode, len(cookies))
			}
			return entry.Host, cookies[0]
		}
		authority, cookie := enter()
		origin := "https://" + authority
		// The ticket lands in the shell, which frames DSH under the Teamwork bar.
		res = request(t, ctx, http.MethodGet, in.URL+"/__dsh/", authority, nil, http.Header{"Sec-Fetch-Site": {"same-origin"}, "Sec-Fetch-Dest": {"document"}, "Cookie": {cookie.String()}})
		shell, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || !strings.Contains(string(shell), `<iframe id="dsh" src="/"`) {
			t.Fatalf("the shell: %d", res.StatusCode)
		}
		browser := func(method, path string, body io.Reader, extra http.Header) *http.Response {
			t.Helper()
			// As the shell's frame asks: DSH only ever runs one frame down (ADR 0065).
			header := http.Header{"Sec-Fetch-Site": {"same-origin"}, "Sec-Fetch-Dest": {"iframe"}, "Cookie": {cookie.String() + "; stolen=1"}}
			for name, values := range extra {
				header[name] = values
			}
			return request(t, ctx, method, in.URL+path, authority, body, header)
		}

		// What reaches DSH: its own Host and page sign-in, none of the
		// browser's credentials, and no launch token from the address.
		res = browser(http.MethodGet, "/echo?token=forged&z=%20&a=1&a=2", nil, http.Header{"Authorization": {"Bearer browser"}, "Referer": {origin + "/secret"}})
		var echo seen
		json.NewDecoder(res.Body).Decode(&echo)
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Set-Cookie") != "" {
			t.Fatalf("echo: %d, Set-Cookie %q", res.StatusCode, res.Header.Get("Set-Cookie"))
		}
		if !strings.HasPrefix(echo.Host, "127.0.0.1:") || echo.Cookie != "dsh=local" || echo.Authorization != "" || echo.Referer != "" || echo.Origin != "" || echo.URL != "/echo?z=%20&a=1&a=2" {
			t.Fatalf("DSH saw %+v", echo)
		}
		dshOrigin := "http://" + echo.Host

		// An upload many times the tunnel's buffers arrives whole while DSH reads it slowly.
		upload := make([]byte, 8<<20)
		rand.Read(upload)
		sum := sha256.Sum256(upload)
		res = browser(http.MethodPost, "/upload", bytes.NewReader(upload), http.Header{"Origin": {origin}, "Content-Type": {"application/octet-stream"}})
		var received struct {
			Bytes  int
			Sha256 string
		}
		json.NewDecoder(res.Body).Decode(&received)
		res.Body.Close()
		if res.StatusCode != 200 || received.Bytes != len(upload) || received.Sha256 != hex.EncodeToString(sum[:]) {
			t.Fatalf("upload: %d %+v", res.StatusCode, received)
		}

		// A body DSH ends by closing the connection arrives whole, not as an error.
		res = browser(http.MethodGet, "/eof", nil, nil)
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || err != nil || len(body) != 200_000 {
			t.Fatalf("eof: %d, %d bytes, %v", res.StatusCode, len(body), err)
		}

		// DSH's own WebSocket rides the same tunnel, with its Origin and sign-in.
		ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(in.URL, "http")+"/api/remote.mux", &websocket.DialOptions{
			Host: authority,
			// As Chromium sends it: an Origin and no Fetch Metadata.
			HTTPHeader: http.Header{"Cookie": {cookie.String()}, "Origin": {origin}},
		})
		if err != nil {
			t.Fatalf("websocket: %v", err)
		}
		ws.SetReadLimit(1 << 20)
		_, first, err := ws.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var upgrade seen
		json.Unmarshal(first, &upgrade)
		if upgrade.Origin != dshOrigin || upgrade.Cookie != "dsh=local" || upgrade.Host != echo.Host {
			t.Fatalf("DSH's socket saw %+v", upgrade)
		}
		for i := range 3 {
			message := bytes.Repeat([]byte{byte('a' + i)}, 300_000)
			if err := ws.Write(ctx, websocket.MessageBinary, message); err != nil {
				t.Fatal(err)
			}
			if _, back, err := ws.Read(ctx); err != nil || !bytes.Equal(back, message) {
				t.Fatalf("echo %d: %d bytes, %v", i, len(back), err)
			}
		}

		// The computer's word ends the browser's access and keeps its link; a new ticket opens it again.
		if _, err := io.WriteString(stdin, "disconnect\n"); err != nil {
			t.Fatal(err)
		}
		if !lines.Scan() || lines.Text() != `{"revoked":true}` {
			t.Fatalf("webRevoke: %q %v", lines.Text(), lines.Err())
		}
		res = browser(http.MethodGet, "/echo", nil, nil)
		res.Body.Close()
		if res.StatusCode != 404 {
			t.Fatalf("the old cookie after webRevoke: %d", res.StatusCode)
		}
		authority, cookie = enter()
		res = browser(http.MethodGet, "/echo", nil, nil)
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("a new ticket after webRevoke: %d", res.StatusCode)
		}
		ws, _, err = websocket.Dial(ctx, "ws"+strings.TrimPrefix(in.URL, "http")+"/api/remote.mux", &websocket.DialOptions{
			Host: authority, HTTPHeader: http.Header{"Cookie": {cookie.String()}, "Origin": {"https://" + authority}},
		})
		if err != nil {
			t.Fatalf("a WebSocket after webRevoke: %v", err)
		}
		ws.SetReadLimit(1 << 20)
		if _, _, err := ws.Read(ctx); err != nil {
			t.Fatal(err)
		}

		// A reconnect ends the browser's access and its open streams; a new ticket opens it again.
		if _, err := io.WriteString(stdin, "reconnect\n"); err != nil {
			t.Fatal(err)
		}
		if again := connected(); again != host {
			t.Fatalf("the computer came back as %q", again)
		}
		if _, _, err := ws.Read(ctx); err == nil {
			t.Fatal("the WebSocket outlived the reconnect")
		}
		res = browser(http.MethodGet, "/echo", nil, nil)
		res.Body.Close()
		if res.StatusCode != 404 {
			t.Fatalf("the old cookie after a reconnect: %d", res.StatusCode)
		}
		authority, cookie = enter()
		res = browser(http.MethodGet, "/echo", nil, nil)
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("a new ticket after a reconnect: %d", res.StatusCode)
		}

		stdin.Close()
		exited = true
		if err := cmd.Wait(); err != nil {
			t.Fatalf("web.mjs: %v", err)
		}
	})
}

// request sends one request to the server, as authority when it is set.
func request(t *testing.T, ctx context.Context, method, target, authority string, body io.Reader, header http.Header) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		t.Fatal(err)
	}
	if authority != "" {
		req.Host = authority
	}
	for name, values := range header {
		req.Header[name] = values
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}
