package app

import (
	"net/http"
	"testing"
)

// An edition's subdomains never share the platform's site, and never nest
// in another registration's, but two registrations may share a site: each
// handler refuses its siblings itself (edition.Host.ServeSubdomains).
func TestWhichSubdomainsAnEditionMayServe(t *testing.T) {
	const app = "https://www.dshteamwork.com"
	served := map[string]http.Handler{"c.dshteam.work": http.NotFoundHandler()}
	for domain, allowed := range map[string]bool{
		"d.dshteam.work":      true,  // beside another registration, on its site
		"web.example.net":     true,  // on a site of its own
		"dshteamwork.com":     false, // APP_URL's parent
		"www.dshteamwork.com": false, // APP_URL's host
		"c.dshteamwork.com":   false, // APP_URL's site, which its cookies' SameSite spans
		"c.dshteam.work":      false, // taken
		"x.c.dshteam.work":    false, // inside a registration: two handlers for one host
		"dshteam.work":        false, // around a registration
		"127.0.0.1":           false,
		"work":                false, // a public suffix
		"":                    false,
	} {
		if err := checkSubdomains(app, domain, served); (err == nil) != allowed {
			t.Errorf("%q: %v", domain, err)
		}
	}
	// A server on an address has no site to share; only its host is refused.
	if err := checkSubdomains("http://127.0.0.1:3800", "c.example.test", nil); err != nil {
		t.Errorf("on an address: %v", err)
	}
}
