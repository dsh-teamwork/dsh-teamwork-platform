package usage

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// ChatFields are the request fields the gateway sends upstream besides the
// model; everything else a caller sends is dropped. RouteBounds refuses any
// other key, so a field added here must first be priced into the bounds.
var ChatFields = []string{"messages", "stream", "stream_options", "temperature", "top_p", "max_tokens",
	"max_completion_tokens", "stop", "tools", "tool_choice", "parallel_tool_calls", "response_format", "reasoning_effort"}

// The largest bounds a route may state: they keep a hold within int64 at any
// valid rate, and are past every context window offered today.
const (
	MaxRouteInput  = 16 << 20
	MaxRouteOutput = 1 << 20
)

// DeepSeekBounds uses the upstream's maximum context as a conservative input
// bound. The downloadable tokenizer is explicitly only an estimate. Custom
// providers remain reportable, but cannot inherit this contract silently.
func DeepSeekBounds(base, model string, payload map[string]json.RawMessage) (Tokens, error) {
	u, err := url.Parse(base)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Scheme != "https" || u.Hostname() != "api.deepseek.com" || u.Port() != "" && u.Port() != "443" ||
		u.Path != "" && u.Path != "/v1" && u.Path != "/v1/" ||
		model != "deepseek-flash" && model != "deepseek-v4-pro" && model != "deepseek-v4-flash" && model != "deepseek-v4-flash-vision-exp" {
		return Tokens{}, wire.E(http.StatusForbidden, "budget_bound_unavailable")
	}
	return RouteBounds(payload, 1<<20, 384<<10)
}

// RouteBounds holds a text and function-call request to a route's trusted
// bounds: maxInput tokens in, and the output it asks for, at most maxOutput
// and 8,192 when it asks for none. It rewrites the request to send that output
// bound, and refuses anything it could not price.
func RouteBounds(payload map[string]json.RawMessage, maxInput, maxOutput int64) (Tokens, error) {
	unsupported := func() (Tokens, error) { return Tokens{}, wire.E(http.StatusBadRequest, "budget_request_unsupported") }
	// Fail closed if a future gateway starts forwarding another billable
	// feature (multiple completions, web search, audio, etc.).
	for key := range payload {
		if key != "model" && !slices.Contains(ChatFields, key) {
			return unsupported()
		}
	}
	if _, a := payload["max_tokens"]; a {
		if _, b := payload["max_completion_tokens"]; b {
			return unsupported()
		}
	}
	output := min(8192, maxOutput)
	for _, key := range []string{"max_tokens", "max_completion_tokens"} {
		if raw, ok := payload[key]; ok {
			if json.Unmarshal(raw, &output) != nil || output < 1 || output > maxOutput {
				return unsupported()
			}
		}
	}
	var messages []map[string]json.RawMessage
	if json.Unmarshal(payload["messages"], &messages) != nil || len(messages) == 0 {
		return unsupported()
	}
	for _, message := range messages {
		var role string
		if json.Unmarshal(message["role"], &role) != nil || role != "system" && role != "user" && role != "assistant" && role != "tool" {
			return unsupported()
		}
		for key, value := range message {
			switch key {
			case "role", "name", "tool_call_id", "reasoning_content":
				var text string
				if json.Unmarshal(value, &text) != nil {
					return unsupported()
				}
			case "content":
				var text *string
				if json.Unmarshal(value, &text) != nil {
					return unsupported()
				}
			case "tool_calls":
				var calls []struct{ Type string }
				if json.Unmarshal(value, &calls) != nil {
					return unsupported()
				}
				for _, call := range calls {
					if call.Type != "function" {
						return unsupported()
					}
				}
			default:
				return unsupported()
			}
		}
	}
	if raw, ok := payload["tools"]; ok {
		var tools []struct{ Type string }
		if json.Unmarshal(raw, &tools) != nil {
			return unsupported()
		}
		for _, tool := range tools {
			if tool.Type != "function" {
				return unsupported()
			}
		}
	}
	// Send the actual documented bound, including when a client used OpenAI's
	// alias. An ignored max_completion_tokens must not leave output unbounded.
	payload["max_tokens"], _ = json.Marshal(output)
	delete(payload, "max_completion_tokens")
	return Tokens{Input: maxInput, Output: output}, nil
}
