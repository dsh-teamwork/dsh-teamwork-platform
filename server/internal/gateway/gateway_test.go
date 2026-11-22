package gateway

import (
	"encoding/json"
	"testing"
)

func TestExplicitEffortUsesTheUpstreamDialect(t *testing.T) {
	// keptEffort is what is left of reasoning_effort after translation.
	for _, tc := range []struct{ base, keptEffort, reasoning, thinking string }{
		{"https://api.deepseek.com/v1", `"max"`, "", `{"type":"enabled"}`},
		{"https://openrouter.ai/api/v1", "", `{"effort":"max"}`, ""},
		{"https://proxy.example/v1", `"max"`, "", ""},
	} {
		for _, selected := range []bool{false, true} {
			payload := map[string]json.RawMessage{}
			if selected {
				payload["reasoning_effort"] = json.RawMessage(`"max"`)
			}
			applyReasoningEffort(tc.base, payload)
			if !selected {
				if len(payload) != 0 {
					t.Errorf("%s: model default added fields: %v", tc.base, payload)
				}
			} else if string(payload["reasoning_effort"]) != tc.keptEffort || string(payload["reasoning"]) != tc.reasoning || string(payload["thinking"]) != tc.thinking {
				t.Errorf("%s: incorrect effort encoding: %v", tc.base, payload)
			}
		}
	}
}

func TestDeepSeekThinkingReplaysEveryAssistantTurnWithReasoning(t *testing.T) {
	messages := `[{"role":"user","content":"hi"},{"role":"assistant","tool_calls":[{"id":"1"}]},{"role":"tool","tool_call_id":"1","content":"ok"},{"role":"assistant","content":"done","reasoning_content":"thought"}]`
	for _, tc := range []struct{ base, effort, want string }{
		{"https://api.deepseek.com", `"high"`, `[{"content":"hi","role":"user"},{"reasoning_content":"","role":"assistant","tool_calls":[{"id":"1"}]},{"content":"ok","role":"tool","tool_call_id":"1"},{"content":"done","reasoning_content":"thought","role":"assistant"}]`},
		{"https://api.deepseek.com", "", messages},
		{"https://openrouter.ai/api/v1", `"high"`, messages},
	} {
		payload := map[string]json.RawMessage{"messages": json.RawMessage(messages)}
		if tc.effort != "" {
			payload["reasoning_effort"] = json.RawMessage(tc.effort)
		}
		applyReasoningEffort(tc.base, payload)
		if string(payload["messages"]) != tc.want {
			t.Errorf("%s %s: messages %s", tc.base, tc.effort, payload["messages"])
		}
	}
}
