// Package gateway is the model gateway (POST /api/llm/chat/completions,
// OpenAI Chat Completions): a member's DSH names a team configuration id as
// the model, and the server calls that team's provider with a key only it
// holds. Nothing a caller sends can name a URL, a header or a credential.
package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/teamconfig"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/usage"
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
	Usage  *usage.Service
}

type target struct {
	teamID, configID, provider, model string
	maxTokens                         int64
	owner, reference                  string
}

// Caller is who a call is billed to: a member (UserID), or a shared DSH
// (HostID, ADR 0042), which has no membership and is held to Team. A
// non-empty Team is a computer or host token's: any other team's model is
// refused.
type Caller struct {
	UserID, HostID, Team string
}

func forbidden() error { return wire.E(http.StatusForbidden, wire.ModelForbidden) }

// resolve is the team a configuration id belongs to and what it calls. The
// caller must be a member of that team, or a shared DSH of it; a config that
// does not exist and one in another team get the same answer (ADR 0013). A
// preset follows its modelConfigId to a model of the same team.
func (g *Gateway) resolve(ctx context.Context, who Caller, configID string) (target, error) {
	if who.HostID != "" && who.Team == "" {
		return target{}, forbidden()
	}
	c, err := g.Team.DB.TeamConfig.Query().
		Where(teamconfig.ID(configID), teamconfig.KindIn(teamconfig.KindModel, teamconfig.KindPreset)).Only(ctx)
	if ent.IsNotFound(err) {
		return target{}, forbidden()
	}
	if err != nil {
		return target{}, err
	}
	if who.Team != "" && c.TeamID != who.Team {
		return target{}, forbidden()
	}
	if who.HostID == "" {
		in, err := g.Team.DB.Membership.Query().Where(membership.UserID(who.UserID), membership.TeamID(c.TeamID)).Exist(ctx)
		if err != nil {
			return target{}, err
		}
		if !in {
			return target{}, forbidden()
		}
	}
	data := c.Data
	effectiveID := c.ID
	owner, reference := c.RouteOwner, c.RouteReference
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
		effectiveID = m.ID
		owner, reference = m.RouteOwner, m.RouteReference
	}
	var route struct {
		Provider  string `json:"provider"`
		Model     string `json:"model"`
		MaxTokens *int64 `json:"maxTokens"`
	}
	if err := json.Unmarshal(data, &route); err != nil || route.Provider == "" || route.Model == "" {
		return target{}, forbidden()
	}
	t := target{teamID: c.TeamID, configID: effectiveID, provider: route.Provider, model: route.Model, owner: owner, reference: reference}
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

// Completions answers one call for who: the provider's body, streamed
// through, with none of its headers.
func (g *Gateway) Completions(w http.ResponseWriter, r *http.Request, who Caller, body []byte) error {
	ctx := r.Context()
	fields, model, stream, err := parse(body)
	if err != nil {
		return err
	}
	t, err := g.resolve(ctx, who, model)
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

	meter := g.Usage
	if meter == nil {
		meter = &usage.Service{DB: g.Team.DB}
	}
	var quote *edition.FundingQuote
	var base, key string
	if t.owner != "" {
		q, e := meter.Quote(ctx, t.owner, edition.ModelReference{TeamID: t.teamID, ConfigID: t.configID, Reference: t.reference})
		if e != nil {
			return e
		}
		quote = &q
		base, key = q.BaseURL, q.APIKey
		t.model = q.Model
		u, e := url.Parse(base)
		if e != nil {
			return wire.E(http.StatusServiceUnavailable, "funding_unavailable")
		}
		if e := g.Team.Network.Check(ctx, u); e != nil {
			return e
		}
	} else {
		base, key, err = g.Team.Route(ctx, t.teamID, t.provider)
		if err != nil {
			return err
		}
	}
	payload := map[string]json.RawMessage{}
	for _, f := range forwarded {
		if v, ok := fields[f]; ok {
			payload[f] = v
		}
	}
	payload["model"], _ = json.Marshal(t.model)
	// Record before dispatch. A caller cannot supply attribution or price facts.
	tracked, err := meter.Begin(ctx, usage.Call{TeamID: t.teamID, UserID: who.UserID, HostID: who.HostID,
		SubmittedConfigID: model, ConfigID: t.configID, Provider: t.provider, Model: t.model, Stream: stream,
		Owner: t.owner, Reference: t.reference, Quote: quote,
		Bounds: func() (usage.Tokens, error) { return usage.DeepSeekBounds(base, t.model, payload) }})
	if err != nil {
		var refusal *wire.Error
		var funding *edition.FundingError
		if errors.As(err, &funding) {
			return err
		}
		if errors.As(err, &refusal) {
			return err
		}
		return wire.E(http.StatusServiceUnavailable, "usage_unavailable")
	}
	observer := usage.NewObserver(stream)
	eof, failure := false, "upstream_unavailable"
	defer func() {
		settle, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := meter.Finish(settle, tracked, observer.Finish(eof), failure); err != nil {
			slog.Error("usage settlement failed", "requestId", tracked.ID, "error", err)
		}
	}()

	out, _ := json.Marshal(payload)
	upstreamCtx, cancelUpstream := context.WithDeadline(ctx, *tracked.DeadlineAt)
	defer cancelUpstream()
	req, err := http.NewRequestWithContext(upstreamCtx, http.MethodPost, base+"/chat/completions", bytes.NewReader(out))
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
	failure = ""
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
			observer.Write(buf[:n])
			if _, werr := w.Write(buf[:n]); werr != nil {
				failure = "client_disconnected"
				return nil // the caller went away
			}
			flush.Flush()
		}
		if err == io.EOF {
			eof = true
			return nil
		}
		if err != nil {
			failure = "upstream_interrupted"
			return nil // headers are sent: the stream simply ends
		}
	}
}
