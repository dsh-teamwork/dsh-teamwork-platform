package gateway

import (
	"encoding/json"
	"testing"
)

func TestExplicitEffortUsesTheUpstreamDialect(t *testing.T) {
	for _, tc := range []struct{ base, effort, reasoning, thinking string }{
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
			} else if string(payload["reasoning_effort"]) != tc.effort || string(payload["reasoning"]) != tc.reasoning || string(payload["thinking"]) != tc.thinking {
				t.Errorf("%s: incorrect effort encoding: %v", tc.base, payload)
			}
		}
	}
}
