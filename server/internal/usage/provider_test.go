package usage

import (
	"encoding/json"
	"testing"
)

func TestProviderBoundsAreConservativeAndActuallyForwarded(t *testing.T) {
	payload := map[string]json.RawMessage{
		"messages":              json.RawMessage(`[{"role":"user","content":"a prompt"}]`),
		"max_completion_tokens": json.RawMessage(`1000`),
		"tools":                 json.RawMessage(`[{"type":"function","function":{"name":"local_tool"}}]`),
	}
	bound, err := DeepSeekBounds("https://api.deepseek.com/v1", "deepseek-flash", payload)
	if err != nil || bound.Input != 1<<20 || bound.Output != 1000 || string(payload["max_tokens"]) != "1000" {
		t.Fatalf("bound/forwarded output diverged: %+v %v %v", bound, err, payload)
	}
	if _, exists := payload["max_completion_tokens"]; exists {
		t.Fatal("unsupported output alias still forwarded")
	}
	for _, base := range []string{"http://api.deepseek.com", "https://api.deepseek.com.evil.test", "https://api.deepseek.com:444", "https://api.deepseek.com/proxy", "https://custom.example/v1"} {
		if _, err := DeepSeekBounds(base, "deepseek-flash", payload); err == nil {
			t.Errorf("unverified route accepted: %s", base)
		}
	}
}

func TestProviderBoundsRejectNonTokenBillableInputs(t *testing.T) {
	for _, body := range []string{
		`{"messages":[{"role":"user","content":"hi"}],"n":2}`,
		`{"messages":[{"role":"user","content":"hi"}],"web_search":true}`,
		`{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://example.test/image"}}]}]}`,
		`{"messages":[{"role":"user","content":"hi"}],"tools":[{"type":"deepseek_web_search"}]}`,
		`{"messages":[{"role":"assistant","content":null,"server_tool_calls":[]}]}`,
		`{"messages":[{}]}`,
		`{"messages":[{"role":"user","content":"hi"}],"max_tokens":999999}`,
		`{"messages":[{"role":"user","content":"hi"}],"max_tokens":1,"max_completion_tokens":2}`,
	} {
		var payload map[string]json.RawMessage
		if err := json.Unmarshal([]byte(body), &payload); err != nil {
			t.Fatal(err)
		}
		if _, err := DeepSeekBounds("https://api.deepseek.com", "deepseek-flash", payload); err == nil {
			t.Errorf("unsupported request admitted: %s", body)
		}
	}
}
