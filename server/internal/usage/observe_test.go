package usage

import (
	"strings"
	"testing"
)

const deepSeekUsage = `{"prompt_tokens":2000,"completion_tokens":1000,"total_tokens":3000,"prompt_cache_hit_tokens":1000,"prompt_cache_miss_tokens":1000,"completion_tokens_details":{"reasoning_tokens":400}}`

func observe(body string, stream, eof bool, step int) Observation {
	o := NewObserver(stream)
	for i := 0; i < len(body); i += step {
		o.Write([]byte(body[i:min(i+step, len(body))]))
	}
	return o.Finish(eof)
}

func TestProviderUsageAcrossStreamBoundaries(t *testing.T) {
	for _, body := range []string{
		"data: {\"id\":\"call-1\",\"choices\":[{\"delta\":{\"content\":\"hello\"}}],\"usage\":null}\n\ndata: {\"id\":\"call-1\",\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":" + deepSeekUsage + "}\n\ndata: [DONE]\n\n",
		": heartbeat\r\n\r\ndata: {\"id\":\"call-1\",\r\ndata: \"usage\":" + deepSeekUsage + "}\r\n\r\ndata: [DONE]\r\n\r\n",
	} {
		for _, step := range []int{1, 7, 4096} {
			r := observe(body, true, true, step)
			if !r.Known || !r.Complete || r.Invalid || r.Tokens != (Tokens{Input: 2000, CacheRead: 1000, Output: 1000, Reasoning: 400}) || r.ID != "call-1" {
				t.Fatalf("step %d: %+v", step, r)
			}
		}
	}
}

func TestJSONAndOpenAIUsage(t *testing.T) {
	body := `{"id":"call-1","usage":{"prompt_tokens":2000,"completion_tokens":1000,"prompt_tokens_details":{"cached_tokens":1000},"completion_tokens_details":{"reasoning_tokens":400}}}`
	r := observe(body, false, true, 1)
	if !r.Known || !r.Complete || r.Invalid || r.Tokens.CacheRead != 1000 || r.Tokens.Reasoning != 400 {
		t.Fatalf("ordinary JSON: %+v", r)
	}
}

func TestMissingInvalidAndInterruptedUsageAreNotZeroSuccess(t *testing.T) {
	for _, body := range []string{
		`{"choices":[]}`,
		`{"usage":null}`,
		`{"usage":{"prompt_tokens":-1,"completion_tokens":1}}`,
		`{"usage":{"prompt_tokens":1.5,"completion_tokens":1}}`,
		`{"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":3}}`,
		`{"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_cache_hit_tokens":2}}`,
		`{"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_cache_hit_tokens":0,"prompt_tokens_details":{"cached_tokens":1}}}`,
		`{"error":{"message":"provider secret"}}`,
		`{"usage":`,
	} {
		if r := observe(body, false, true, 5); r.Known {
			t.Fatalf("invalid usage counted: %s %+v", body, r)
		}
	}
	body := "data: {\"usage\":" + deepSeekUsage + "}\n\n"
	if r := observe(body, true, true, 1); !r.Known || r.Complete {
		t.Fatalf("missing terminal marker: %+v", r)
	}
	if r := observe(body+"data: [DONE]\n\n", true, false, 7); r.Complete {
		t.Fatalf("read failure is not a complete response: %+v", r)
	}
	if r := observe(strings.Repeat("x", ObservationLimit+1), false, true, 32768); !r.Invalid || r.Known {
		t.Fatalf("unbounded JSON retained: %+v", r)
	}
}

func TestConflictingUsageCannotReplaceTheFirstTotal(t *testing.T) {
	body := "data: {\"usage\":" + deepSeekUsage + "}\n\ndata: {\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n"
	if r := observe(body, true, true, 1); !r.Invalid || r.Known {
		t.Fatalf("conflicting totals: %+v", r)
	}
}

func TestOpenRouterCacheWritesAndCost(t *testing.T) {
	usage := `{"prompt_tokens":3000,"completion_tokens":100,"total_tokens":3100,"cost":1.25e-03,"prompt_tokens_details":{"cached_tokens":1000,"cache_write_tokens":1500}}`
	body := "data: {\"id\":\"gen-1\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n: OPENROUTER PROCESSING\n\ndata: {\"id\":\"gen-1\",\"choices\":[],\"usage\":" + usage + "}\n\ndata: [DONE]\n\n"
	r := observe(body, true, true, 5)
	if !r.Known || !r.Complete || r.Invalid || r.Tokens != (Tokens{Input: 3000, CacheRead: 1000, CacheWrite: 1500, Output: 100}) || r.Cost != "1.25e-03" {
		t.Fatalf("OpenRouter usage: %+v", r)
	}
	for _, bad := range []string{
		`{"prompt_tokens":10,"completion_tokens":1,"cost":-1}`,
		`{"prompt_tokens":10,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":6,"cache_write_tokens":5}}`,
	} {
		if r := observe(`{"usage":`+bad+`}`, false, true, 3); !r.Invalid || r.Known {
			t.Errorf("accepted %s: %+v", bad, r)
		}
	}
	twice := "data: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":1,\"cost\":0.1}}\n\ndata: {\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":1,\"cost\":0.2}}\n\ndata: [DONE]\n\n"
	if r := observe(twice, true, true, 4096); !r.Invalid {
		t.Fatalf("a second, different cost replaced the first: %+v", r)
	}
}
