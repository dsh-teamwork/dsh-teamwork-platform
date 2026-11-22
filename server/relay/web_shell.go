package relay

import (
	"embed"
	"encoding/json"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
)

// The shell (ADR 0065): the gateway's own pages on a computer's origin, under
// a prefix it never proxies. A ticket is spent at desktopWebEnter, and the
// shell at desktopWebShell frames DSH under the Teamwork bar.
const (
	desktopWebEnter = "/__dsh/enter"
	desktopWebShell = "/__dsh/"
)

//go:embed shell/index.html shell/bar.js shell/bar.css
var shellFiles embed.FS

var shellPage = template.Must(template.ParseFS(shellFiles, "shell/index.html"))

// The shell's own pages run only its own script and style, and are framed by
// nobody.
const shellPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// words are the shell's, in locale, with the English for any missing.
func words(locale string) map[string]string {
	out := map[string]string{}
	for key, word := range messages["en"] {
		if strings.HasPrefix(key, "shell.") {
			out[key] = word
		}
	}
	for key, word := range messages[locale] {
		if strings.HasPrefix(key, "shell.") {
			out[key] = word
		}
	}
	return out
}

// framePath is the DSH page the shell frames: a path on this origin, never
// another origin's and never the shell's own.
func framePath(raw string) string {
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, desktopWebShell) || strings.ContainsAny(raw, "\\\r\n\t") {
		return "/"
	}
	return raw
}

func (d *desktopWeb) shell(w http.ResponseWriter, req *http.Request, host *desktopWebHost, session *desktopWebSession) {
	w.Header().Set("Content-Security-Policy", shellPolicy)
	switch {
	case req.Method == http.MethodGet && req.URL.Path == desktopWebShell:
		session.touch()
		said := words(session.locale)
		encoded, _ := json.Marshal(said)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		shellPage.Execute(w, map[string]any{
			"Lang": session.locale, "Name": host.name, "Path": framePath(req.URL.Query().Get("path")),
			// Built by the gateway from APP_URL or the app's own scheme, never from the request.
			"Back":      template.URL(session.back),
			"Words":     string(encoded),
			"BackLabel": said["shell.back"], "EndLabel": said["shell.end"], "EndedLabel": said["shell.ended"],
		})
	case req.Method == http.MethodGet && (req.URL.Path == desktopWebShell+"bar.js" || req.URL.Path == desktopWebShell+"bar.css"):
		http.ServeFileFS(w, req, shellFiles, "shell/"+strings.TrimPrefix(req.URL.Path, desktopWebShell))
	case req.Method == http.MethodGet && req.URL.Path == desktopWebShell+"status":
		// Not activity: a shell left open over a quiet DSH still lapses.
		var dial *int64
		if us := host.lastDial.Load(); us > 0 {
			ms := (us + 999) / 1000
			dial = &ms
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"name": host.name, "connected": host.socket.ctx.Err() == nil,
			"up": session.up.Load(), "down": session.down.Load(), "dialMs": dial,
			"endsAt": session.entered.Add(desktopWebLife).UTC().Format(time.RFC3339),
		})
	case req.Method == http.MethodPost && req.URL.Path == desktopWebShell+"end":
		d.mu.Lock()
		for id, s := range host.sessions {
			if s == session {
				delete(host.sessions, id)
			}
		}
		d.mu.Unlock()
		session.end()
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, req)
	}
}

// closed answers a request no live session admits: a page saying so, with
// the way back to Teamwork, where a person opened it, and a bare 404 to
// anything else.
func (d *desktopWeb) closed(w http.ResponseWriter, req *http.Request) {
	switch req.Header.Get("Sec-Fetch-Dest") {
	case "document", "iframe":
	default:
		http.NotFound(w, req)
		return
	}
	said := words(web.ViewerLocale(req, ""))
	w.Header().Set("Content-Security-Policy", shellPolicy)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	closedPage.Execute(w, map[string]any{
		"Lang": web.ViewerLocale(req, ""), "Title": said["shell.closedTitle"], "Body": said["shell.closedBody"],
		"Open": said["shell.openTeamwork"], "Home": d.home,
	})
}

var closedPage = template.Must(template.New("closed").Parse(`<!doctype html>
<html lang="{{.Lang}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title><link rel="stylesheet" href="/__dsh/bar.css"></head>
<body><main class="ended"><h1>{{.Title}}</h1><p>{{.Body}}</p><a class="button" href="{{.Home}}" target="_top">{{.Open}}</a></main></body></html>
`))
