package analytics_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/analytics"
)

// documented is docs/ops/analytics.md's events table: each event and the
// property keys its row names (values sit in parentheses after a key).
func documented(t *testing.T) map[string][]string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../docs/ops/analytics.md"))
	if err != nil {
		t.Fatal(err)
	}
	var section string
	for _, s := range strings.Split(string(raw), "\n## ") {
		if strings.HasPrefix(s, "3. Events") {
			section = s
		}
	}
	if section == "" {
		t.Fatal(`docs/ops/analytics.md has no "## 3. Events" section`)
	}
	name := regexp.MustCompile("^`([a-z_]+)`$")
	key := regexp.MustCompile("`([a-z_]+)`")
	parens := regexp.MustCompile(`\([^)]*\)`)
	rows := map[string][]string{}
	for _, line := range strings.Split(section, "\n") {
		cells := strings.Split(line, "|")
		if len(cells) < 6 {
			continue
		}
		m := name.FindStringSubmatch(strings.TrimSpace(cells[1]))
		if m == nil {
			continue
		}
		var props []string
		for _, k := range key.FindAllStringSubmatch(parens.ReplaceAllString(cells[4], ""), -1) {
			props = append(props, k[1])
		}
		slices.Sort(props)
		rows[m[1]] = props
	}
	return rows
}

// A missing row is an event nobody can interpret; a stale one sends a query
// after something that never arrives.
func TestEventTableMatchesEvents(t *testing.T) {
	docs := documented(t)
	for name, e := range analytics.Events {
		props, ok := docs[name]
		if !ok {
			t.Errorf("%s is not in docs/ops/analytics.md", name)
			continue
		}
		var want []string
		for k := range e.Properties {
			want = append(want, k)
		}
		slices.Sort(want)
		if !slices.Equal(props, want) {
			t.Errorf("%s: documented properties %v, declared %v", name, props, want)
		}
	}
	for name := range docs {
		if _, ok := analytics.Events[name]; !ok {
			t.Errorf("docs/ops/analytics.md lists %s, which analytics.Events does not declare", name)
		}
	}
}

func TestEventNamesAreObjectVerbPastTense(t *testing.T) {
	// object_verb: a past participle last, or before one particle (signed_up).
	pattern := regexp.MustCompile(`^[a-z]+(_[a-z]+)*_[a-z]+ed(_[a-z]+)?$`)
	for name := range analytics.Events {
		if !pattern.MatchString(name) {
			t.Errorf("%s is not object_verb in snake_case, past tense", name)
		}
	}
}

func TestCheckRefusesWhatIsNotDeclared(t *testing.T) {
	if err := analytics.Check("user_signed_up", map[string]any{"via": "google", "client": "web"}); err != nil {
		t.Fatalf("a declared event: %v", err)
	}
	for name, props := range map[string]map[string]any{
		"an undeclared property": {"via": "google", "client": "web", "email": "a@example.test"},
		"a missing property":     {"via": "google"},
		"a value off the list":   {"via": "github", "client": "web"},
	} {
		if analytics.Check("user_signed_up", props) == nil {
			t.Errorf("accepted %s: %v", name, props)
		}
	}
	if analytics.Check("profile_updated", map[string]any{"fields": []string{"name", "name"}, "client": "web"}) == nil {
		t.Error("accepted a list naming a field twice")
	}
	if analytics.Check("nobody_declared", map[string]any{}) == nil {
		t.Error("accepted an undeclared event")
	}
}

func TestCaptureSendsUnderTheUserWithoutGeoIP(t *testing.T) {
	got := make(chan map[string]any, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if r.Method != http.MethodPost || r.URL.Path != "/i/v0/e/" || json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}
		got <- body
	}))
	defer srv.Close()

	(&analytics.Client{Key: "phc_test", Host: srv.URL}).Capture("u1", "user_signed_up", map[string]any{"via": "google", "client": "web"})
	var body map[string]any
	select {
	case body = <-got:
	case <-time.After(5 * time.Second):
		t.Fatal("no event arrived")
	}
	props, _ := body["properties"].(map[string]any)
	if body["api_key"] != "phc_test" || body["event"] != "user_signed_up" || body["distinct_id"] != "u1" ||
		props["$geoip_disable"] != true || props["via"] != "google" || props["client"] != "web" {
		t.Fatalf("sent %v", body)
	}
}

func TestCaptureWithoutKeySendsNothing(t *testing.T) {
	sent := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { sent <- struct{}{} }))
	defer srv.Close()

	(&analytics.Client{Host: srv.URL}).Capture("u1", "user_signed_up", map[string]any{"via": "google", "client": "web"})
	select {
	case <-sent:
		t.Fatal("sent an event with no key")
	case <-time.After(200 * time.Millisecond):
	}
}
