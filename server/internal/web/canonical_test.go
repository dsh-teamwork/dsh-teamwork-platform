package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Ported from apps/web/src/lib/__tests__/canonical-host.test.ts. The Node
// rule's AUTH_URL and NODE_ENV are not this binary's: APP_URL alone names the
// origin, and https is what makes it production.
func TestCanonicalHost(t *testing.T) {
	served := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	send := func(appURL, method, target string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		CanonicalHost(appURL, served).ServeHTTP(w, httptest.NewRequest(method, target, nil))
		return w
	}

	t.Run("sends www to the apex when the apex is the origin, path and query kept", func(t *testing.T) {
		w := send("https://dshteamwork.com/", "POST", "https://www.dshteamwork.com/teams/x?tab=members")
		if w.Code != http.StatusPermanentRedirect || w.Header().Get("Location") != "https://dshteamwork.com/teams/x?tab=members" {
			t.Fatalf("%d %s", w.Code, w.Header().Get("Location"))
		}
	})

	t.Run("sends the apex to www when www is the origin", func(t *testing.T) {
		w := send("https://www.dshteamwork.com", "GET", "https://dshteamwork.com/")
		if w.Code != http.StatusPermanentRedirect || w.Header().Get("Location") != "https://www.dshteamwork.com/" {
			t.Fatalf("%d %s", w.Code, w.Header().Get("Location"))
		}
	})

	t.Run("matches only the twin, so any other host is served rather than bounced", func(t *testing.T) {
		if w := send("https://dshteamwork.com", "GET", "https://WWW.dshteamwork.com:443/"); w.Code != http.StatusPermanentRedirect {
			t.Fatalf("the twin with a port and capitals: %d", w.Code)
		}
		for _, host := range []string{"wwwXdshteamwork.com", "dshteamwork.com", "manage.dshteamwork.com", "web-production.up.railway.app"} {
			if w := send("https://dshteamwork.com", "GET", "https://"+host+"/"); w.Code != http.StatusTeapot {
				t.Fatalf("%s: %d", host, w.Code)
			}
		}
	})

	t.Run("does nothing without a public https origin", func(t *testing.T) {
		for _, appURL := range []string{"", "http://dshteamwork.com", "https://localhost:3800", "https://127.0.0.1", "not a url"} {
			for _, host := range []string{"www.dshteamwork.com", "dshteamwork.com", "www.localhost", "www.127.0.0.1"} {
				if w := send(appURL, "GET", "http://"+host+"/"); w.Code != http.StatusTeapot {
					t.Fatalf("%q from %s: %d", appURL, host, w.Code)
				}
			}
		}
	})
}
