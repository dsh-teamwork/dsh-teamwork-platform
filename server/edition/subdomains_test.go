package edition_test

import (
	"io"
	"net/http"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition/editiontest"
)

// An edition's subdomains are its own: every request for one reaches its
// handler, with the site's security headers, and no other request does.
func TestAnEditionServesTheSubdomainsOfItsDomain(t *testing.T) {
	var refused []error
	ext := edition.Extension{Name: "subdomains", Mount: func(h edition.Host) (func(), error) {
		serve := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "edition:"+r.Host) })
		if err := h.ServeSubdomains("c.example.test", serve); err != nil {
			return nil, err
		}
		// A sibling on the same site has subdomains of its own.
		sibling := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "sibling:"+r.Host) })
		if err := h.ServeSubdomains("d.example.test", sibling); err != nil {
			return nil, err
		}
		// An address or a bare suffix is no domain, and one is taken once: never
		// again, inside another or around one, so each host has one handler.
		refused = append(refused, h.ServeSubdomains("127.0.0.1", serve), h.ServeSubdomains("0.1", serve), h.ServeSubdomains("C.example.test.", serve), h.ServeSubdomains("", serve), h.ServeSubdomains("nested.c.example.test", serve), h.ServeSubdomains("example.test", serve), h.ServeSubdomains("d.example.test", serve))
		return nil, nil
	}}
	editiontest.Each(t, []edition.Extension{ext}, editiontest.Options{}, func(t *testing.T, in *editiontest.Instance) {
		for i, err := range refused {
			if err == nil {
				t.Errorf("registration %d was accepted", i)
			}
		}
		get := func(host, path string) (string, *http.Response) {
			req, _ := http.NewRequest("GET", in.URL+path, nil)
			req.Host = host
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			return string(body), res
		}
		for _, host := range []string{"abc.c.example.test", "ABC.C.Example.Test:443", "a.b.c.example.test"} {
			if body, res := get(host, "/api/configs"); body != "edition:"+host || res.Header.Get("X-Frame-Options") != "DENY" {
				t.Errorf("%s: %q %v", host, body, res.Header)
			}
		}
		if body, _ := get("abc.d.example.test", "/api/configs"); body != "sibling:abc.d.example.test" {
			t.Errorf("the sibling's subdomain reached %q", body)
		}
		for _, host := range []string{"c.example.test", "abc.c.example.test.evil", "abcc.example.test"} {
			if body, _ := get(host, "/api/configs"); body == "edition:"+host {
				t.Errorf("%s reached the edition", host)
			}
		}
	})
}
