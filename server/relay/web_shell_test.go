package relay

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

// DSH runs only inside the shell, under the Teamwork bar, on the computer's
// own origin (ADR 0065).
func TestDesktopWebShell(t *testing.T) {
	const domain = "desktop.example.test"
	idle := desktopWebIdle
	t.Cleanup(func() { desktopWebIdle = idle })
	// DSH's own response, with a policy that would forbid any frame.
	const answer = "HTTP/1.1 200 OK\r\nContent-Security-Policy: default-src 'self'; frame-ancestors 'none'\r\nX-Frame-Options: DENY\r\nContent-Length: 4\r\n\r\nDSH!"
	editiontest.Each(t, []edition.Extension{Extension(30*time.Second, false)}, editiontest.Options{
		Env: map[string]string{"DESKTOP_WEB_DOMAIN": domain},
	}, func(t *testing.T, in *editiontest.Instance) {
		ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
		defer cancel()
		owner := in.Account("owner@example.test")
		in.Team(owner)
		hostID := desktopWebComputer(t, ctx, in, in.Bearer(owner), answer)
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		type reply struct {
			code   int
			header http.Header
			body   string
		}
		call := func(method, target, authority string, header http.Header, cookie *http.Cookie, body io.Reader) reply {
			t.Helper()
			req, _ := http.NewRequestWithContext(ctx, method, in.URL+target, body)
			req.Host = authority
			for name, values := range header {
				req.Header[name] = values
			}
			if cookie != nil {
				req.AddCookie(cookie)
			}
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			b, _ := io.ReadAll(res.Body)
			return reply{res.StatusCode, res.Header, string(b)}
		}
		page := http.Header{"Sec-Fetch-Site": {"same-origin"}, "Sec-Fetch-Dest": {"document"}}
		frame := http.Header{"Sec-Fetch-Site": {"same-origin"}, "Sec-Fetch-Dest": {"iframe"}}
		// ticket asks as the browser (with returnTo) or the app, and enters.
		ticket := func(app bool, returnTo string, language string) (string, *http.Cookie) {
			t.Helper()
			header := http.Header{"Accept-Language": {language}}
			var body io.Reader
			if app {
				header.Set("Authorization", "Bearer "+in.Bearer(owner))
			} else {
				header.Set("Cookie", in.Session(owner, "password").String())
				header.Set("Origin", in.URL)
				header.Set("Content-Type", "application/json")
				body = strings.NewReader(`{"returnTo":"` + returnTo + `"}`)
			}
			r := call(http.MethodPost, "/api/relay/hosts/"+hostID+"/web/ticket", "", header, nil, body)
			var issued struct{ URL string }
			json.Unmarshal([]byte(r.body), &issued)
			entry, err := url.Parse(issued.URL)
			if r.code != 200 || err != nil || entry.Path != desktopWebEnter {
				t.Fatalf("ticket: %d %s", r.code, r.body)
			}
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, in.URL+entry.RequestURI(), nil)
			req.Host = entry.Host
			req.Header.Set("Sec-Fetch-Site", "cross-site")
			req.Header.Set("Sec-Fetch-Dest", "document")
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != 200 || len(res.Cookies()) != 1 || !strings.Contains(string(b), `url=`+desktopWebShell+`"`) {
				t.Fatalf("enter: %d %s", res.StatusCode, b)
			}
			return entry.Host, res.Cookies()[0]
		}

		// A console page to return to is the member's own My DSH, or nothing.
		bad := call(http.MethodPost, "/api/relay/hosts/"+hostID+"/web/ticket", "", http.Header{
			"Cookie": {in.Session(owner, "password").String()}, "Origin": {in.URL}, "Content-Type": {"application/json"},
		}, nil, strings.NewReader(`{"returnTo":"https://elsewhere.example/teams/x/my-dsh"}`))
		if bad.code != 400 {
			t.Fatalf("a foreign returnTo: %d", bad.code)
		}

		host, cookie := ticket(false, "/teams/core/my-dsh/"+hostID, "en")
		shell := call(http.MethodGet, desktopWebShell, host, page, cookie, nil)
		if shell.code != 200 || shell.header.Get("Content-Security-Policy") != shellPolicy || shell.header.Get("X-Frame-Options") != "DENY" ||
			!strings.Contains(shell.body, `<iframe id="dsh" src="/"`) || !strings.Contains(shell.body, `href="`+in.URL+`/teams/core/my-dsh/`+hostID+`"`) ||
			!strings.Contains(shell.body, "Back to Teamwork") || !strings.Contains(shell.body, `<html lang="en">`) {
			t.Fatalf("the shell: %d %v\n%s", shell.code, shell.header, shell.body)
		}
		for _, asset := range []string{"bar.js", "bar.css"} {
			if r := call(http.MethodGet, desktopWebShell+asset, host, http.Header{"Sec-Fetch-Site": {"same-origin"}}, cookie, nil); r.code != 200 || r.body == "" {
				t.Fatalf("%s: %d", asset, r.code)
			}
		}
		// The frame's path stays on this origin and off the shell.
		for raw, want := range map[string]string{"/x?y=1": `src="/x?y=1"`, "//elsewhere.example/": `src="/"`, desktopWebShell + "status": `src="/"`} {
			if r := call(http.MethodGet, desktopWebShell+"?path="+url.QueryEscape(raw), host, page, cookie, nil); !strings.Contains(r.body, want) {
				t.Fatalf("path %q framed as %s", raw, r.body)
			}
		}

		// A page opened at the top lands in a shell; the frame reaches DSH, framed by its own origin alone.
		if r := call(http.MethodGet, "/sessions/7?tab=a", host, page, cookie, nil); r.code != 303 || r.header.Get("Location") != desktopWebShell+"?path="+url.QueryEscape("/sessions/7?tab=a") {
			t.Fatalf("a top-level page: %d %s", r.code, r.header.Get("Location"))
		}
		framed := call(http.MethodGet, "/", host, frame, cookie, nil)
		policies := strings.Join(framed.header.Values("Content-Security-Policy"), " | ")
		if framed.code != 200 || framed.body != "DSH!" || framed.header.Get("X-Frame-Options") != "" ||
			!strings.Contains(policies, "default-src 'self'") || !strings.Contains(policies, "frame-ancestors 'self'") || strings.Contains(policies, "'none'") {
			t.Fatalf("DSH in the frame: %d %q %v", framed.code, framed.body, framed.header)
		}

		// The bar's status counts the traffic, and is not activity.
		var status struct {
			Name      string
			Connected bool
			Up, Down  int64
			DialMs    *int64
		}
		r := call(http.MethodGet, desktopWebShell+"status", host, http.Header{"Sec-Fetch-Site": {"same-origin"}}, cookie, nil)
		json.Unmarshal([]byte(r.body), &status)
		if r.code != 200 || status.Name != "Desktop" || !status.Connected || status.Up == 0 || status.Down == 0 || status.DialMs == nil {
			t.Fatalf("status: %d %s", r.code, r.body)
		}
		desktopWebIdle = 400 * time.Millisecond
		for range 4 {
			call(http.MethodGet, desktopWebShell+"status", host, http.Header{"Sec-Fetch-Site": {"same-origin"}}, cookie, nil)
			time.Sleep(150 * time.Millisecond)
		}
		if r := call(http.MethodGet, desktopWebShell+"status", host, http.Header{"Sec-Fetch-Site": {"same-origin"}}, cookie, nil); r.code != 404 {
			t.Fatalf("status kept an idle session: %d", r.code)
		}
		desktopWebIdle = time.Hour

		// The phone app's session goes back to the app, in the console's language.
		host, cookie = ticket(true, "", "zh-CN,zh;q=0.9")
		if r := call(http.MethodGet, desktopWebShell, host, page, cookie, nil); !strings.Contains(r.body, `href="dshteamwork://"`) || !strings.Contains(r.body, `<html lang="zh-CN">`) {
			t.Fatalf("the app's shell: %s", r.body)
		}

		// Ending needs the page's own Origin; once ended, nothing opens and a person is told so.
		if r := call(http.MethodPost, desktopWebShell+"end", host, http.Header{"Sec-Fetch-Site": {"same-origin"}}, cookie, nil); r.code != 403 {
			t.Fatalf("an end without its Origin: %d", r.code)
		}
		if r := call(http.MethodPost, desktopWebShell+"end", host, http.Header{"Sec-Fetch-Site": {"same-origin"}, "Origin": {"https://" + host}}, cookie, nil); r.code != 204 {
			t.Fatalf("end: %d", r.code)
		}
		closed := call(http.MethodGet, desktopWebShell, host, page, cookie, nil)
		if closed.code != 404 || !strings.Contains(closed.body, "Native DSH Web is closed") || !strings.Contains(closed.body, `href="`+in.URL+`/"`) {
			t.Fatalf("after ending: %d %s", closed.code, closed.body)
		}
		if r := call(http.MethodGet, "/", host, http.Header{"Sec-Fetch-Site": {"same-origin"}}, cookie, nil); r.code != 404 || strings.Contains(r.body, "<html") {
			t.Fatalf("a fetch after ending: %d %s", r.code, r.body)
		}
	})
}
