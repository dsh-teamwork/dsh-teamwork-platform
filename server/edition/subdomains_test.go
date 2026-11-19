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
		// APP_URL's own host and its parents are the site's, and a domain is taken once.
		refused = append(refused, h.ServeSubdomains("127.0.0.1", serve), h.ServeSubdomains("0.1", serve), h.ServeSubdomains("C.example.test.", serve), h.ServeSubdomains("", serve))
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
		for _, host := range []string{"c.example.test", "abc.c.example.test.evil", "abcc.example.test"} {
			if body, _ := get(host, "/api/configs"); body == "edition:"+host {
				t.Errorf("%s reached the edition", host)
			}
		}
	})
}
