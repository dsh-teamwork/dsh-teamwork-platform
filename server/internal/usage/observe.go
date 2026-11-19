package usage

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
)

// ObservationLimit bounds retained bytes independently of the amount streamed.
// An oversized or malformed frame stays unmeasured, never a zero-token success.
const ObservationLimit = 4 << 20

// Observation is what a response said about itself. Cost is the upstream's
// own price for the call, verbatim, when it states one (OpenRouter's
// usage.cost, in US dollars); it is never a reason to accept the tokens.
type Observation struct {
	Tokens   Tokens
	Cost     string `json:",omitempty"`
	Known    bool
	Complete bool
	Invalid  bool
	ID       string
}

// Observer receives the same byte slices forwarded to the client. It stores at
// most one JSON body/SSE frame and token facts, never conversation content.
type Observer struct {
	stream bool
	line   []byte
	data   []byte
	result Observation
	done   bool
}

func NewObserver(stream bool) *Observer { return &Observer{stream: stream} }

func (o *Observer) Write(p []byte) {
	if o.result.Invalid {
		return
	}
	if !o.stream {
		if len(o.data)+len(p) > ObservationLimit {
			o.invalid()
			return
		}
		o.data = append(o.data, p...)
		return
	}
	for _, c := range p {
		if c == '\n' {
			o.lineEnd()
			o.line = o.line[:0]
		} else {
			if len(o.line)+len(o.data) >= ObservationLimit {
				o.invalid()
				return
			}
			o.line = append(o.line, c)
		}
		if o.result.Invalid {
			return
		}
	}
}

func (o *Observer) invalid() {
	o.result.Invalid = true
	o.result.Known = false
	o.line, o.data = nil, nil
}

func (o *Observer) lineEnd() {
	line := bytes.TrimSuffix(o.line, []byte{'\r'})
	if len(line) == 0 {
		o.event()
		return
	}
	if bytes.HasPrefix(line, []byte("data:")) {
		data := bytes.TrimPrefix(line[5:], []byte{' '})
		o.data = append(o.data, data...)
		o.data = append(o.data, '\n')
	}
}

func (o *Observer) event() {
	data := bytes.TrimSpace(o.data)
	if len(data) == 0 {
		return
	}
	if o.done {
		o.invalid()
		return
	}
	if bytes.Equal(data, []byte("[DONE]")) {
		o.done = true
	} else {
		o.decode(data)
	}
	o.data = o.data[:0]
}

// Finish requires transport EOF and, for SSE, the terminal marker. Even valid
// totals from a truncated response are retained only as pending evidence.
func (o *Observer) Finish(eof bool) Observation {
	if !o.stream && eof && !o.result.Invalid {
		o.decode(o.data)
	}
	o.result.Complete = eof && !o.result.Invalid && (!o.stream || o.done)
	return o.result
}

func (o *Observer) decode(data []byte) {
	var frame struct {
		ID    string          `json:"id"`
		Usage json.RawMessage `json:"usage"`
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(data, &frame) != nil || len(frame.Error) > 0 && string(frame.Error) != "null" {
		o.invalid()
		return
	}
	if frame.ID != "" {
		if len(frame.ID) > 200 || o.result.ID != "" && o.result.ID != frame.ID {
			o.invalid()
			return
		}
		o.result.ID = frame.ID
	}
	if len(frame.Usage) == 0 || bytes.Equal(frame.Usage, []byte("null")) {
		return
	}
	var raw struct {
		Input  *int64       `json:"prompt_tokens"`
		Output *int64       `json:"completion_tokens"`
		Total  *int64       `json:"total_tokens"`
		Hit    *int64       `json:"prompt_cache_hit_tokens"`
		Miss   *int64       `json:"prompt_cache_miss_tokens"`
		Cost   *json.Number `json:"cost"`
		Prompt struct {
			Cached *int64 `json:"cached_tokens"`
			// OpenRouter reports cache writes here, beside the reads.
			Written *int64 `json:"cache_write_tokens"`
		} `json:"prompt_tokens_details"`
		Completion struct {
			Reasoning *int64 `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	}
	if json.Unmarshal(frame.Usage, &raw) != nil || raw.Input == nil || raw.Output == nil {
		o.invalid()
		return
	}
	t := Tokens{Input: *raw.Input, Output: *raw.Output}
	if raw.Hit != nil {
		t.CacheRead = *raw.Hit
	}
	if raw.Prompt.Cached != nil {
		if raw.Hit != nil && *raw.Hit != *raw.Prompt.Cached {
			o.invalid()
			return
		}
		t.CacheRead = *raw.Prompt.Cached
	}
	if raw.Prompt.Written != nil {
		t.CacheWrite = *raw.Prompt.Written
	}
	if raw.Completion.Reasoning != nil {
		t.Reasoning = *raw.Completion.Reasoning
	}
	cost := ""
	if raw.Cost != nil {
		f, err := strconv.ParseFloat(raw.Cost.String(), 64)
		if err != nil || f < 0 || math.IsInf(f, 0) || len(*raw.Cost) > 40 {
			o.invalid()
			return
		}
		cost = raw.Cost.String()
	}
	if !t.Valid() || raw.Total != nil && *raw.Total != t.Input+t.Output || raw.Miss != nil && *raw.Miss != t.Input-t.CacheRead {
		o.invalid()
		return
	}
	if o.result.Known && (o.result.Tokens != t || o.result.Cost != cost) {
		o.invalid()
		return
	}
	o.result.Tokens, o.result.Cost, o.result.Known = t, cost, true
}
