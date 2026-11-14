package web

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

// CanonicalHost answers a request to the www/apex twin of APP_URL with a
// permanent redirect to APP_URL, path and query kept: one host, not two, as
// router9's canonical-host.mjs does.
//
// Serving the app on both hosts breaks sign-in: the session cookie is
// host-only, and Google returns to the one callback APP_URL names, so a
// sign-in begun on the twin arrives without its state and fails.
//
// It matches the one twin rather than "any host that is not canonical": that
// rule loops as soon as a proxy rewrites Host, and would bounce a platform's
// own hostnames. It applies only where APP_URL is public https, which is how a
// production instance is told from a local one (the Node rule also asked for
// NODE_ENV=production, which this binary has no equivalent of). 308, so a
// POST stays a POST.
func CanonicalHost(appURL string, next http.Handler) http.Handler {
	origin, twin := canonicalTwin(appURL)
	if twin == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if strings.EqualFold(host, twin) {
			http.Redirect(w, r, origin+r.URL.RequestURI(), http.StatusPermanentRedirect)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// canonicalTwin is APP_URL's origin and the host to send to it, or "" for
// both when APP_URL is not an origin a stranger may be sent to permanently:
// https, and not loopback.
func canonicalTwin(appURL string) (origin, twin string) {
	u, err := url.Parse(strings.TrimSpace(appURL))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return "", ""
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return "", ""
	}
	if rest, ok := strings.CutPrefix(host, "www."); ok {
		twin = rest
	} else {
		twin = "www." + host
	}
	return u.Scheme + "://" + u.Host, twin
}
