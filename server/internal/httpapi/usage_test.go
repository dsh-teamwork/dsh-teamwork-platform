package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/testdb"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/usage"
)

const usageFixture = `{"prompt_tokens":2000,"completion_tokens":1000,"total_tokens":3000,"prompt_cache_hit_tokens":1000,"prompt_cache_miss_tokens":1000,"completion_tokens_details":{"reasoning_tokens":400}}`

func rateBody(revision int, input string) map[string]any {
	return map[string]any{"revision": revision, "basis": "cost", "input": input, "cacheRead": "0.2", "cacheWrite": "0", "output": "8"}
}

func TestUsagePricesJSONStreamsAndUncertainResponses(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		var mode atomic.Int32
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			if mode.Load() == 0 {
				answerJSON(w, `{"id":"provider-call","choices":[],"usage":`+usageFixture+`}`)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"id\":\"provider-call\",\"choices\":[],\"usage\":"+usageFixture+"}\n\n")
			if mode.Load() == 1 {
				io.WriteString(w, "data: [DONE]\n\n")
			}
		})
		admin := e.admin("admin@usage.test")
		teamID, modelID := stubTeam(t, admin, u, "sk-test")
		path := "/api/teams/" + teamID
		p := e.pluginFor(admin)
		must(t, call(p, modelID, false), 200)
		v := must(t, admin.get(path+"/usage"), 200)
		first := v["entries"].([]any)[0].(map[string]any)
		if first["state"] != "unpriced" || first["points"] != nil || first["input"] != float64(2000) {
			t.Fatalf("unpriced must not be zero: %+v", first)
		}
		ratePath := path + "/model-rates/" + modelID
		must(t, admin.send("PUT", ratePath, rateBody(0, "2")), 200)
		must(t, call(p, modelID, false), 200)
		mode.Store(1)
		if r := call(p, modelID, true); r.status != 200 {
			t.Fatalf("stream failed: %d %s", r.status, r.body)
		}
		mode.Store(2)
		if r := call(p, modelID, true); r.status != 200 {
			t.Fatalf("truncated stream failed: %d %s", r.status, r.body)
		}
		v = must(t, admin.get(path+"/usage"), 200)
		var measured, pending, unpriced int
		for _, row := range v["entries"].([]any) {
			entry := row.(map[string]any)
			switch entry["state"] {
			case "settled":
				measured++
				if entry["points"] != "10.2" || entry["output"] != float64(1000) || entry["reasoning"] != float64(400) {
					t.Fatalf("cache/reasoning double counted: %+v", entry)
				}
			case "pending":
				pending++
				if entry["points"] != nil {
					t.Fatalf("interrupted response charged: %+v", entry)
				}
			case "unpriced":
				unpriced++
			}
		}
		if measured != 2 || pending != 1 || unpriced != 1 {
			t.Fatalf("measured=%d pending=%d unpriced=%d: %+v", measured, pending, unpriced, v)
		}
		refused(t, "stale rate form", admin.send("PUT", ratePath, rateBody(0, "99")), 409, "rate_changed")
		refused(t, "excess rate precision", admin.send("PUT", ratePath, rateBody(1, "0.0000001")), 400, "invalid_request")
	})
}

func TestUsageScopeAndPresetAttribution(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { answerJSON(w, `{"usage":`+usageFixture+`}`) })
		admin := e.admin("admin@usage.test")
		teamID, modelID := stubTeam(t, admin, u, "sk-test")
		path := "/api/teams/" + teamID
		member, memberID := e.person("member@usage.test")
		must(t, admin.post(path+"/members", map[string]string{"email": "member@usage.test"}), 201)
		must(t, admin.send("PUT", path+"/model-rates/"+modelID, rateBody(0, "2")), 200)
		presetID := must(t, admin.post(path+"/configs", map[string]any{"kind": "preset", "name": "Alias", "data": map[string]any{"modelConfigId": modelID}}), 201)["id"].(string)
		must(t, call(e.pluginFor(admin), modelID, false), 200)
		must(t, call(e.pluginFor(member), presetID, false), 200)
		v := must(t, member.get(path+"/usage?userId=someone-else"), 200)
		if v["total"] != float64(1) {
			t.Fatalf("member saw other usage: %+v", v)
		}
		entry := v["entries"].([]any)[0].(map[string]any)
		if entry["userId"] != memberID || entry["configId"] != modelID || entry["points"] != "10.2" {
			t.Fatalf("preset did not use effective model: %+v", entry)
		}
		refused(t, "member rate edit", member.send("PUT", path+"/model-rates/"+modelID, rateBody(1, "3")), 403, "admin_required")
		outsider, _ := e.person("outsider@usage.test")
		refused(t, "outside team", outsider.get(path+"/usage"), 404, "team_not_found")
		refused(t, "outside team rate", outsider.get(path+"/model-rates/"+modelID), 404, "team_not_found")
		refused(t, "invalid page", admin.get(path+"/usage?page=-1"), 400, "invalid_request")
	})
}

func TestUsageCapturesPriceBeforeDispatchAndSettlesOnce(t *testing.T) {
	testdb.Each(t, func(t *testing.T, d *testdb.DB) {
		e := start(t, d, options{allowPrivate: true})
		started, resume := make(chan struct{}), make(chan struct{})
		u := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			close(started)
			select {
			case <-resume:
				answerJSON(w, `{"usage":`+usageFixture+`}`)
			case <-r.Context().Done():
			}
		})
		admin := e.admin("admin@usage.test")
		teamID, modelID := stubTeam(t, admin, u, "sk-test")
		path := "/api/teams/" + teamID
		must(t, admin.send("PUT", path+"/model-rates/"+modelID, rateBody(0, "2")), 200)
		p := e.pluginFor(admin)
		done := make(chan response, 1)
		go func() { done <- call(p, modelID, false) }()
		<-started
		changed := admin.send("PUT", path+"/model-rates/"+modelID, rateBody(1, "20"))
		close(resume)
		must(t, changed, 200)
		must(t, <-done, 200)
		v := must(t, admin.get(path+"/usage"), 200)
		if entry := v["entries"].([]any)[0].(map[string]any); entry["points"] != "10.2" {
			t.Fatalf("in-flight price changed: %+v", entry)
		}
		row := d.Client.UsageRequest.Query().Where(usagerequest.ConfigID(modelID)).OnlyX(context.Background())
		s := &usage.Service{DB: d.Client}
		if err := s.Finish(context.Background(), row, usage.Observation{Known: true, Complete: true, Tokens: usage.Tokens{Input: 1}}, ""); err != nil {
			t.Fatal(err)
		}
		after := d.Client.UsageRequest.GetX(context.Background(), row.ID)
		var snapshot usage.Rates
		if err := json.Unmarshal(after.Rates, &snapshot); err != nil {
			t.Fatal(err)
		}
		if after.PointUnits == nil || *after.PointUnits != *row.PointUnits || snapshot.Input != 2_000_000 {
			t.Fatalf("settlement replay changed facts: %+v", after)
		}
	})
}
