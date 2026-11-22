package edition

import "net/http"

// FromOwnPages reports whether a request to a page served through
// Host.ServeSubdomains came from that origin's own pages, or straight from
// the person (typed, bookmarked, opened by an app). Registrations may share a
// site, so the browser sends a SameSite=Lax cookie on a sibling's requests;
// Fetch Metadata tells them apart. Where a browser sends none, as Chromium
// does on a WebSocket handshake, the request passes only if its Origin is
// this one. Any Origin present must be this one, and writes and upgrades
// need it.
func FromOwnPages(r *http.Request, origin string) bool {
	got := r.Header.Get("Origin")
	if got != "" && got != origin {
		return false
	}
	write := r.Method != http.MethodGet && r.Method != http.MethodHead
	if (write || r.Header.Get("Upgrade") != "") && got != origin {
		return false
	}
	switch r.Header.Get("Sec-Fetch-Site") {
	case "same-origin", "none":
		return true
	case "":
		return got == origin
	}
	return false
}
