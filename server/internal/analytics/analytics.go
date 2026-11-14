// Package analytics is server-side product analytics (docs/ops/analytics.md):
// what the server sees happen to an account, sent to PostHog under the
// account's id. Off without POSTHOG_KEY. Capturing never waits and never
// fails a request; an event that does not match its declaration is not sent,
// and is logged rather than dropped silently.
package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"
)

// Event is one event the product sends: when it fires, and the properties
// it may carry. No property carries anything a person typed: enumerations
// and counts only.
type Event struct {
	Description string
	// Properties names each property and the values it may take; a property
	// not named here is refused.
	Properties map[string]Values
}

// Values is what one property may hold.
type Values struct {
	OneOf []string // a single value from this list
	List  bool     // a non-empty list of values from OneOf, each once
}

var client = Values{OneOf: []string{"web", "plugin"}}

// Events is every event the server sends; docs/ops/analytics.md lists the
// same, and a test holds the two together.
var Events = map[string]Event{
	"user_signed_up": {
		Description: "Server: a person's own first sign-in made their account.",
		Properties:  map[string]Values{"via": {OneOf: []string{"google", "email", "password"}}, "client": client},
	},
	"profile_updated": {
		Description: "Server: PATCH /api/profile changed the profile; lists which fields, never their values.",
		Properties:  map[string]Values{"fields": {OneOf: []string{"name", "locale"}, List: true}, "client": client},
	},
}

// Check is nil when props match the event's declaration.
func Check(event string, props map[string]any) error {
	e, ok := Events[event]
	if !ok {
		return fmt.Errorf("%s is not declared", event)
	}
	for k, v := range props {
		spec, ok := e.Properties[k]
		if !ok {
			return fmt.Errorf("%s: property %q is not declared", event, k)
		}
		if spec.List {
			list, ok := v.([]string)
			if !ok || len(list) == 0 {
				return fmt.Errorf("%s: %s must be a non-empty list", event, k)
			}
			for i, item := range list {
				if !slices.Contains(spec.OneOf, item) || slices.Contains(list[:i], item) {
					return fmt.Errorf("%s: %s holds %q", event, k, item)
				}
			}
			continue
		}
		if s, ok := v.(string); !ok || !slices.Contains(spec.OneOf, s) {
			return fmt.Errorf("%s: %s may not be %v", event, k, v)
		}
	}
	for k := range e.Properties {
		if _, ok := props[k]; !ok {
			return fmt.Errorf("%s: property %q is missing", event, k)
		}
	}
	return nil
}

// Client sends to one PostHog project.
type Client struct {
	Key  string // POSTHOG_KEY; empty sends nothing
	Host string // POSTHOG_HOST; https://us.i.posthog.com when empty
	HTTP *http.Client
}

// Capture sends event for the user in the background.
func (c *Client) Capture(userID, event string, props map[string]any) {
	if c == nil || c.Key == "" {
		return
	}
	if err := Check(event, props); err != nil {
		slog.Error("analytics event not sent: it does not match analytics.Events", "error", err)
		return
	}
	properties := map[string]any{"$geoip_disable": true}
	for k, v := range props {
		properties[k] = v
	}
	body, _ := json.Marshal(map[string]any{
		"api_key": c.Key, "event": event, "distinct_id": userID, "properties": properties,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	go c.send(body, event)
}

func (c *Client) send(body []byte, event string) {
	host := c.Host
	if host == "" {
		host = "https://us.i.posthog.com"
	}
	h := c.HTTP
	if h == nil {
		h = http.DefaultClient
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, host+"/i/v0/e/", bytes.NewReader(body))
	if err != nil {
		slog.Error("analytics event not sent", "event", event, "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := h.Do(req)
	if err != nil {
		slog.Error("analytics event not sent", "event", event, "error", err)
		return
	}
	res.Body.Close()
	if res.StatusCode >= 300 {
		slog.Error("analytics event refused", "event", event, "status", res.StatusCode)
	}
}
