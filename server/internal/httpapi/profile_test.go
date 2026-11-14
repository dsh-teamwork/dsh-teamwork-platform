package httpapi_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
)

func TestProfileWithoutIdentity(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		for _, method := range []string{"GET", "PATCH"} {
			var body any
			if method == "PATCH" {
				body = map[string]string{"name": "x"}
			}
			r := do(t, http.DefaultClient, method, e.url+"/api/profile", body, map[string]string{"Origin": e.url})
			if r.status != 401 || string(r.body) != "{\"error\":\"unauthorized\"}\n" {
				t.Fatalf("%s anonymous: %d %q", method, r.status, r.body)
			}
		}
	})
}

func TestProfile(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{})
		b := e.admin("a@x.io")

		t.Run("answers in the wire shape", func(t *testing.T) {
			v := must(t, b.get("/api/profile"), 200)
			if len(v) != 5 || v["id"] == "" || v["email"] != "a@x.io" || v["name"] != nil || v["image"] != nil || v["locale"] != nil {
				t.Fatalf("profile: %v", v)
			}
		})

		t.Run("applies a patch, and null clears a field", func(t *testing.T) {
			v := must(t, b.send("PATCH", "/api/profile", map[string]any{"name": "Ada", "locale": "zh-CN"}), 200)
			if v["name"] != "Ada" || v["locale"] != "zh-CN" {
				t.Fatalf("patched: %v", v)
			}
			v = must(t, b.send("PATCH", "/api/profile", map[string]any{"name": nil}), 200)
			if v["name"] != nil || v["locale"] != "zh-CN" {
				t.Fatalf("name cleared: %v", v)
			}
			if v := must(t, b.get("/api/profile"), 200); v["name"] != nil || v["locale"] != "zh-CN" {
				t.Fatalf("read back: %v", v)
			}
		})

		t.Run("rejects an invalid patch with issues naming the field", func(t *testing.T) {
			for field, patch := range map[string]map[string]any{
				"name":   {"name": ""},
				"locale": {"locale": "fr"},
			} {
				r := b.send("PATCH", "/api/profile", patch)
				var v struct {
					Error  string `json:"error"`
					Issues []struct {
						Path []any `json:"path"`
					} `json:"issues"`
				}
				if r.status != 400 || json.Unmarshal(r.body, &v) != nil || v.Error != "invalid_request" ||
					len(v.Issues) != 1 || len(v.Issues[0].Path) != 1 || v.Issues[0].Path[0] != field {
					t.Fatalf("%v: %d %s", patch, r.status, r.body)
				}
			}
			if v := must(t, b.get("/api/profile"), 200); v["locale"] != "zh-CN" {
				t.Fatalf("an invalid patch changed the profile: %v", v)
			}
		})

		t.Run("answers a body that is not JSON with a 400", func(t *testing.T) {
			refused(t, "not JSON", b.send("PATCH", "/api/profile", "{"), 400, "invalid_request")
		})

		t.Run("the plugin's Bearer reads and writes the same profile", func(t *testing.T) {
			p := e.pluginFor(b)
			if v := must(t, p.send("PATCH", "/api/profile", map[string]any{"locale": "en"}), 200); v["locale"] != "en" {
				t.Fatalf("plugin patch: %v", v)
			}
			if v := must(t, b.get("/api/profile"), 200); v["locale"] != "en" || v["email"] != "a@x.io" {
				t.Fatalf("browser after the plugin's patch: %v", v)
			}
			if v := must(t, p.get("/api/profile"), 200); v["locale"] != "en" {
				t.Fatalf("plugin read: %v", v)
			}
		})
	})
}
