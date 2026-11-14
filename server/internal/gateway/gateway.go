// Package gateway is the model gateway (POST /api/llm/chat/completions,
// OpenAI Chat Completions): a member's DSH names a team configuration id as
// the model, and the server calls that team's provider with a key only it
// holds. Nothing a caller sends can name a URL, a header or a credential.
package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strings"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// MaxBody is the largest request: a long conversation with tool results is
// far larger than an ordinary JSON body.
const MaxBody = 4 << 20

// forwarded are the request fields sent upstream; everything else a caller
// sends is dropped.
var forwarded = []string{"messages", "stream", "stream_options", "temperature", "top_p", "max_tokens",
	"max_completion_tokens", "stop", "tools", "tool_choice", "parallel_tool_calls", "response_format", "reasoning_effort"}

// Gateway calls providers for the team rules in Team.
type Gateway struct {
	Team   *team.Service
	Client *http.Client // Team.Network.Client() in production
}

type target struct {
	teamID, provider, model string
	maxTokens               int64
}

func forbidden() error { return wire.E(http.StatusForbidden, wire.ModelForbidden) }

// resolve is the team a configuration id belongs to and what it calls. The
// caller must be a member of that team; a config that does not exist and one
// in another team get the same answer (ADR 0013). A preset follows its
// modelConfigId to a model of the same team.
func (g *Gateway) resolve(ctx context.Context, userID, configID string) (target, error) {
	c, err := g.Team.DB.TeamConfig.Query().
		Where(teamconfig.ID(configID), teamconfig.KindIn(teamconfig.KindModel, teamconfig.KindPreset)).Only(ctx)
	if ent.IsNotFound(err) {
		return target{}, forbidden()
	}
	if err != nil {
		return target{}, err
	}
	in, err := g.Team.DB.Membership.Query().Where(membership.UserID(userID), membership.TeamID(c.TeamID)).Exist(ctx)
	if err != nil {
		return target{}, err
	}
	if !in {
		return target{}, forbidden()
	}
	data := c.Data
	var ref struct {
		ModelConfigID *string `json:"modelConfigId"`
	}
	if c.Kind == teamconfig.KindPreset && json.Unmarshal(data, &ref) == nil && ref.ModelConfigID != nil {
		m, err := g.Team.DB.TeamConfig.Query().
			Where(teamconfig.ID(*ref.ModelConfigID), teamconfig.TeamID(c.TeamID), teamconfig.KindEQ(teamconfig.KindModel)).Only(ctx)
		if ent.IsNotFound(err) {
			return target{}, forbidden()
		}
		if err != nil {
			return target{}, err
		}
		data = m.Data
	}
	var route struct {
		Provider  string `json:"provider"`
		Model     string `json:"model"`
		MaxTokens *int64 `json:"maxTokens"`
	}
	if err := json.Unmarshal(data, &route); err != nil || route.Provider == "" || route.Model == "" {
		return target{}, forbidden()
	}
	t := target{teamID: c.TeamID, provider: route.Provider, model: route.Model}
	if route.MaxTokens != nil {
		t.maxTokens = *route.MaxTokens
	}
	return t, nil
}

// request is the part of a body the gateway reads; the rest is forwarded or
// dropped as raw JSON.
func parse(body []byte) (map[string]json.RawMessage, string, bool, error) {
	var fields map[string]json.RawMessage
	var is wire.Issues
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		is.Add("Expected an object")
		return nil, "", false, is.Err()
	}
	var model string
	if json.Unmarshal(fields["model"], &model) != nil || model == "" {
		is.Add("A configuration id", "model")
	}
	var messages []json.RawMessage
	if json.Unmarshal(fields["messages"], &messages) != nil || len(messages) == 0 {
		is.Add("At least one message", "messages")
	}
	var stream bool
	if raw, ok := fields["stream"]; ok && json.Unmarshal(raw, &stream) != nil {
		is.Add("A boolean", "stream")
	}
	return fields, model, stream, is.Err()
}

// Completions answers one call: the provider's body, streamed through, with
// none of its headers.
func (g *Gateway) Completions(w http.ResponseWriter, r *http.Request, userID string, body []byte) error {
	ctx := r.Context()
	fields, model, stream, err := parse(body)
	if err != nil {
		return err
	}
	t, err := g.resolve(ctx, userID, model)
	if err != nil {
		return err
	}
	tooMany := wire.E(http.StatusBadRequest, wire.MaxTokensExceedsContext)
	_, hasMax := fields["max_tokens"]
	_, hasMaxC := fields["max_completion_tokens"]
	if hasMax && hasMaxC {
		return tooMany
	}
	for _, f := range []string{"max_tokens", "max_completion_tokens"} {
		raw, ok := fields[f]
		if !ok {
			continue
		}
		var n float64
		if json.Unmarshal(raw, &n) != nil || n < 1 || n != math.Trunc(n) || n > 1<<53-1 || (t.maxTokens > 0 && n > float64(t.maxTokens)) {
			return tooMany
		}
	}
	if t.maxTokens > 0 && !hasMax && !hasMaxC {
		fields["max_tokens"], _ = json.Marshal(t.maxTokens)
	}

	base, key, err := g.Team.Route(ctx, t.teamID, t.provider)
	if err != nil {
		return err
	}
	payload := map[string]json.RawMessage{}
	for _, f := range forwarded {
		if v, ok := fields[f]; ok {
			payload[f] = v
		}
	}
	payload["model"], _ = json.Marshal(t.model)
	out, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(out))
	if err != nil {
		return wire.E(http.StatusBadGateway, wire.UpstreamUnavailable)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := g.Client.Do(req)
	if err != nil {
		return wire.E(http.StatusBadGateway, wire.UpstreamUnavailable)
	}
	defer res.Body.Close()
	ct := res.Header.Get("Content-Type")
	switch {
	case res.StatusCode == http.StatusTooManyRequests:
		return wire.E(http.StatusTooManyRequests, wire.UpstreamRateLimited)
	case res.StatusCode < 200 || res.StatusCode > 299,
		stream && !strings.Contains(ct, "text/event-stream"),
		!stream && !strings.Contains(ct, "application/json"):
		return wire.E(http.StatusBadGateway, wire.UpstreamUnavailable)
	}
	// Upstream headers (cookies, request ids, rate-limit detail) are not passed on.
	h := w.Header()
	if stream {
		h.Set("Content-Type", "text/event-stream")
	} else {
		h.Set("Content-Type", "application/json")
	}
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flush := http.NewResponseController(w)
	buf := make([]byte, 32<<10)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return nil // the caller went away
			}
			flush.Flush()
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return nil // headers are sent: the stream simply ends
		}
	}
}
