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

func TestRouteBoundsComeFromTheRoute(t *testing.T) {
	payload := map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"user","content":"hi"}]`)}
	bound, err := RouteBounds(payload, 200_000, 4096)
	if err != nil || bound != (Tokens{Input: 200_000, Output: 4096}) || string(payload["max_tokens"]) != "4096" {
		t.Fatalf("an unasked output must default within the route: %+v %v %s", bound, err, payload["max_tokens"])
	}
	payload["max_tokens"] = json.RawMessage(`4097`)
	if _, err := RouteBounds(payload, 200_000, 4096); err == nil {
		t.Fatal("an output past the route's bound was admitted")
	}
	payload["max_tokens"] = json.RawMessage(`100`)
	if bound, err := RouteBounds(payload, 200_000, 4096); err != nil || bound.Output != 100 {
		t.Fatalf("asked output: %+v %v", bound, err)
	}
	payload["provider"] = json.RawMessage(`{"order":["x"]}`)
	if _, err := RouteBounds(payload, 200_000, 4096); err == nil {
		t.Fatal("a caller's routing field was admitted")
	}
}

// A reasoning model's reply comes back in the next request of the same turn,
// after its tool call ran, with its reasoning under the name the upstream used:
// OpenRouter's `reasoning` and `reasoning_details`, or `reasoning_text`. Each is
// input the route's input bound already covers, so it is admitted and sent on
// unchanged; a malformed one is still refused.
func TestRouteBoundsAdmitAReplayedReasoningReply(t *testing.T) {
	for _, field := range []string{
		`"reasoning_content":"thinking"`,
		`"reasoning":"thinking"`,
		`"reasoning_text":"thinking"`,
		`"reasoning":"thinking","reasoning_details":[{"type":"reasoning.text","text":"thinking","format":"anthropic-claude-v1","index":0}]`,
	} {
		messages := `[{"role":"user","content":"list the files"},` +
			`{"role":"assistant","content":null,` + field + `,"tool_calls":[{"id":"c1","type":"function","function":{"name":"Shell","arguments":"{}"}}]},` +
			`{"role":"tool","tool_call_id":"c1","content":"a.txt"}]`
		payload := map[string]json.RawMessage{"messages": json.RawMessage(messages)}
		if _, err := RouteBounds(payload, 200_000, 4096); err != nil {
			t.Fatalf("refused a replayed reply with %s: %v", field, err)
		}
		if string(payload["messages"]) != messages {
			t.Fatalf("the replayed reply was changed: %s", payload["messages"])
		}
	}
	for _, field := range []string{`"reasoning":{"text":"x"}`, `"reasoning_text":1`, `"reasoning_details":"x"`, `"reasoning_details":["x"]`} {
		payload := map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"assistant","content":"hi",` + field + `}]`)}
		if _, err := RouteBounds(payload, 200_000, 4096); err == nil {
			t.Errorf("admitted a malformed %s", field)
		}
	}
}
