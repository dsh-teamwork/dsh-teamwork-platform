package wire_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// A preset as an admin writes it: it references a team model.
const preset = `"kind":"preset","name":"Review","data":{"modelConfigId":"m","description":"Review code","requiredTools":["Read"],"optionalTools":%s,"systemPrompt":"Do not interpolate {{text}}"%s}`

func config(t *testing.T, body string) error {
	t.Helper()
	var c wire.ConfigInput
	if err := json.Unmarshal([]byte(body), &c); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	return c.Validate()
}

func presetWith(optionalTools, extra string) string {
	return "{" + fmt.Sprintf(preset, optionalTools, extra) + "}"
}

func TestConfigInputTakesEitherRoute(t *testing.T) {
	var c wire.ConfigInput
	if err := json.Unmarshal([]byte(presetWith(`["Shell"]`, "")), &c); err != nil {
		t.Fatal(err)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("preset referencing a team model: %v", err)
	}
	if c.Preset == nil || c.Preset.ModelConfigID == nil || *c.Preset.ModelConfigID != "m" ||
		c.Preset.SystemPrompt != "Do not interpolate {{text}}" || len(c.Preset.OptionalTools) != 1 {
		t.Fatalf("parsed preset: %+v", c.Preset)
	}
	if err := config(t, `{"kind":"preset","name":"Review","data":{"provider":"kimi","model":"legacy"}}`); err != nil {
		t.Fatalf("preset with its own route: %v", err)
	}
}

func TestConfigInputRefusesMixedOrMissingRoute(t *testing.T) {
	if config(t, presetWith(`["Shell"]`, `,"provider":"local","model":"secret"`)) == nil {
		t.Fatal("accepted a preset naming a team model and its own route")
	}
	if config(t, `{"kind":"preset","name":"Review","data":{"systemPrompt":"No model"}}`) == nil {
		t.Fatal("accepted a preset with no route")
	}
}

func TestConfigInputRefusesDuplicates(t *testing.T) {
	if config(t, presetWith(`["Read"]`, "")) == nil {
		t.Fatal("accepted a tool listed as both required and optional")
	}
	dep := `{"pluginConfigId":"p1","version":"1.0.0"}`
	if config(t, presetWith(`["Shell"]`, `,"pluginDependencies":[`+dep+`,`+dep+`]`)) == nil {
		t.Fatal("accepted a plugin listed twice")
	}
}

// No URL or key can ride along in a field the kind does not declare.
func TestConfigInputRefusesUndeclaredFields(t *testing.T) {
	for _, body := range []string{
		`{"kind":"model","name":"m","data":{"provider":"p","model":"m","apiKey":"k"}}`,
		`{"kind":"plugin","name":"p","data":{"package":"x","version":"1.0.0","url":"https://x"}}`,
	} {
		if config(t, body) == nil {
			t.Errorf("accepted %s", body)
		}
	}
}

func TestConfigInputPinsPluginToExactVersion(t *testing.T) {
	if config(t, `{"kind":"plugin","name":"p","data":{"package":"@a/b","version":"^1.0.0"}}`) == nil {
		t.Fatal("accepted a version range")
	}
	if err := config(t, `{"kind":"plugin","name":"p","data":{"package":"@a/b","version":"1.0.0-rc.1"}}`); err != nil {
		t.Fatalf("refused an exact prerelease: %v", err)
	}
}

func TestUpdateConfigNamesItsVersion(t *testing.T) {
	update := func(body string) error {
		var u wire.UpdateConfig
		if err := json.Unmarshal([]byte(body), &u); err != nil {
			t.Fatal(err)
		}
		return u.Validate()
	}
	if update(presetWith(`["Shell"]`, "")) == nil {
		t.Fatal("accepted an edit without a version")
	}
	withVersion := presetWith(`["Shell"]`, "")
	withVersion = withVersion[:len(withVersion)-1] + `,"version":1}`
	if err := update(withVersion); err != nil {
		t.Fatalf("refused an edit with a version: %v", err)
	}
}

func TestReturnPathStaysOnOrigin(t *testing.T) {
	for asked, want := range map[string]string{
		"/settings?tab=a#x":     "/settings?tab=a#x",
		"https://evil.example/": "/",
		"//evil.example/":       "/",
		`/\evil.example`:        "/",
		"/a\nb":                 "/",
		"settings":              "/",
		"":                      "/",
	} {
		if got := wire.ReturnPath(asked, "/"); got != want {
			t.Errorf("ReturnPath(%q) = %q, want %q", asked, got, want)
		}
	}
	if got := wire.ReturnPath("//x", "/dashboard"); got != "/dashboard" {
		t.Errorf("fallback: got %q", got)
	}
}

func TestVerifyCodeInput(t *testing.T) {
	if got, ok := wire.Email(" A@Example.com "); !ok || got != "a@example.com" {
		t.Errorf("Email normalised to %q, %v", got, ok)
	}
	for code, want := range map[string]bool{"123456": true, "12345a": false, "12345": false, "1234567": false, " 123456": false} {
		if wire.SixDigits.MatchString(code) != want {
			t.Errorf("SixDigits(%q) = %v", code, !want)
		}
	}
}

// Where a code may be sent instead of shown (ADR 0010, ADR 0012).
func TestReturnAddress(t *testing.T) {
	if _, ok := wire.ReturnAddress("dshteamwork://sign-in", ""); ok {
		t.Error("sent a code somewhere with no mobile prefix configured")
	}

	const prefix = "dshteamwork://sign-in"
	if got, ok := wire.ReturnAddress(prefix, prefix); !ok || got != (wire.ReturnTo{URL: prefix, To: "app"}) {
		t.Errorf("prefix itself: %+v %v", got, ok)
	}
	for _, uri := range []string{"https://evil.example/sign-in", "dshteamwork://other", "evil://dshteamwork://sign-in", ""} {
		if got, ok := wire.ReturnAddress(uri, prefix); ok {
			t.Errorf("accepted %q as %+v", uri, got)
		}
	}

	const loopback = "http://127.0.0.1:53124/callback"
	if got, ok := wire.ReturnAddress(loopback, ""); !ok || got != (wire.ReturnTo{URL: loopback, To: "dsh"}) {
		t.Errorf("loopback: %+v %v", got, ok)
	}
	for _, uri := range []string{
		"http://127.0.0.1/callback",
		"https://127.0.0.1:53124/callback",
		"http://localhost:53124/callback",
		"http://[::1]:53124/callback",
		"http://127.0.0.1:53124@evil.example/callback",
		"http://user:pass@127.0.0.1:53124/callback",
		"http://127.0.0.1.evil.example:53124/callback",
		"http://127.0.0.2:53124/callback",
	} {
		if got, ok := wire.ReturnAddress(uri, prefix); ok {
			t.Errorf("accepted look-alike %q as %+v", uri, got)
		}
	}
}
