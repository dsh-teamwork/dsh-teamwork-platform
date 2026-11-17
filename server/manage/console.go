package manage

// The console's pages: apps/manage, a Vite app built into dist/ by
// its embed script, served at /manage with index.html for every page path.

import (
	"embed"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/web"
)

//go:embed all:dist
var dist embed.FS

// csp keeps the console to its own scripts and styles: whatever else its
// instance serves, a script from anywhere else must not run here.
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

func mountConsole(mux *http.ServeMux, console edition.AdminConsole, devOrigin string) {
	if devOrigin != "" {
		// The Vite server's base is the console's (apps/manage/vite.config.ts),
		// so its modules and pages are all under it.
		u, err := url.Parse(devOrigin)
		if err != nil {
			panic(err)
		}
		mux.Handle(console.Base+"/", web.DevProxy(u, "the management Vite server"))
		if console.Base != "" {
			mux.Handle("GET "+console.Base, http.RedirectHandler(console.Base+"/", http.StatusMovedPermanently))
		}
		return
	}
	root := console.Files
	var err error
	if root == nil {
		root, err = fs.Sub(dist, "dist")
	}
	if err != nil {
		panic(err)
	}
	files := http.FileServerFS(root)
	page := func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Security-Policy", csp)
		name := strings.TrimPrefix(r.URL.Path, console.Base+"/")
		if name != "" && !strings.HasSuffix(name, "/") {
			if f, err := root.Open(path.Clean(name)); err == nil {
				f.Close()
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				r2 := r.Clone(r.Context())
				r2.URL.Path = "/" + name
				files.ServeHTTP(w, r2)
				return
			}
		}
		// Every other path is a page the console routes itself.
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFileFS(w, r, root, "index.html")
	}
	mux.HandleFunc(console.Base+"/", page)
	if console.Base != "" {
		mux.Handle("GET "+console.Base, http.RedirectHandler(console.Base+"/", http.StatusMovedPermanently))
	}
}
