package edition_test

import (
	"net/http/httptest"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
)

// Only an origin's own pages, or the person going there directly, pass; a
// sibling on the same site never does, whatever its request carries.
func TestARequestComesFromItsOwnPages(t *testing.T) {
	const own, sibling = "https://a.d.example.test", "https://b.d.example.test"
	for _, c := range []struct {
		name, method, site, origin string
		upgrade, want              bool
	}{
		{"a page's own GET", "GET", "same-origin", "", false, true},
		{"typed or opened by an app", "GET", "none", "", false, true},
		{"its own fetch", "GET", "same-origin", own, false, true},
		{"its own write", "POST", "same-origin", own, false, true},
		{"its own WebSocket, as Chromium sends it", "GET", "", own, true, true},
		{"a browser without Fetch Metadata, naming this origin", "GET", "", own, false, true},
		{"a sibling's link or image", "GET", "same-site", "", false, false},
		{"a sibling's fetch", "GET", "same-site", sibling, false, false},
		{"anywhere else", "GET", "cross-site", "", false, false},
		{"another Origin with same-origin claimed", "GET", "same-origin", sibling, false, false},
		{"no Fetch Metadata and no Origin", "GET", "", "", false, false},
		{"a sibling's WebSocket", "GET", "", sibling, true, false},
		{"a write without Origin", "POST", "same-origin", "", false, false},
		{"an upgrade without Origin", "GET", "none", "", true, false},
	} {
		r := httptest.NewRequest(c.method, own+"/", nil)
		if c.site != "" {
			r.Header.Set("Sec-Fetch-Site", c.site)
		}
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		if c.upgrade {
			r.Header.Set("Upgrade", "websocket")
		}
		if got := edition.FromOwnPages(r, own); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}
