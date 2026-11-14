package web

import (
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// LocaleCookie is the cookie a chosen language is kept in, signed in or not.
const LocaleCookie = "locale"

const defaultLocale = "en"

var traditional = regexp.MustCompile(`(?i)-(hant|tw|hk|mo)\b`)

// MatchLocale is the best interface language for tags in preference order,
// or English. An exact match wins; otherwise the language decides, so `zh`,
// `zh-Hans` and `zh-SG` read Simplified Chinese, and a Traditional-script tag
// falls through to the next preference rather than guess. A port of
// matchLocale in packages/shared/src/locales.ts.
func MatchLocale(tags []string) string {
	for _, tag := range tags {
		for _, l := range wire.Locales {
			if strings.EqualFold(l, tag) {
				return l
			}
		}
		language := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
		if language == "zh" {
			if traditional.MatchString(tag) {
				continue
			}
			return "zh-CN"
		}
		for _, l := range wire.Locales {
			if strings.SplitN(l, "-", 2)[0] == language {
				return l
			}
		}
	}
	return defaultLocale
}

// AcceptLanguage is the header's tags in preference order: by q, highest
// first, ties in the order given, `q=0` and `*` dropped.
func AcceptLanguage(header string) []string {
	type entry struct {
		tag string
		q   float64
	}
	var entries []entry
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		tag, q := strings.TrimSpace(fields[0]), 1.0
		for _, p := range fields[1:] {
			if v, ok := strings.CutPrefix(strings.TrimSpace(p), "q="); ok {
				if n, err := strconv.ParseFloat(v, 64); err == nil {
					q = n
				} else {
					q = 0 // JavaScript's Number() reads garbage as NaN, which no q > 0 keeps
				}
			}
		}
		if tag != "" && tag != "*" && q > 0 {
			entries = append(entries, entry{tag, q})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].q > entries[j].q })
	tags := make([]string, len(entries))
	for i, e := range entries {
		tags[i] = e.tag
	}
	return tags
}

// viewerLocale is the language a page renders in, never from the URL: the
// signed-in profile's choice, then the cookie, then Accept-Language.
func viewerLocale(r *http.Request, profile string) string {
	if wire.IsLocale(profile) {
		return profile
	}
	if c, err := r.Cookie(LocaleCookie); err == nil && wire.IsLocale(c.Value) {
		return c.Value
	}
	return MatchLocale(AcceptLanguage(r.Header.Get("Accept-Language")))
}
