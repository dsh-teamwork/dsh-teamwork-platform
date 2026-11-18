package relay

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

// console is an HTTP request from the web console: the member's session
// cookie, this site's Origin, no Bearer, and the browser's handset credential.
func (w *world) console(userID, method, path, key string, site bool) (int, obj) {
	w.t.Helper()
	req, _ := http.NewRequest(method, w.in.URL+path, bytes.NewReader(nil))
	req.AddCookie(w.in.Session(userID, "password"))
	if site {
		req.Header.Set("Origin", w.in.URL)
	}
	if key != "" {
		req.Header.Set("X-Device-Key", key)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		w.t.Fatal(err)
	}
	defer res.Body.Close()
	var out obj
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// The web console sees the member's own computers with every device paired to
// them, and can cut off any of those devices, a lost phone included (ADR
// 0048). It reaches no other member's, and an app's token keeps to its own
// handset (the hosted edition's ADR 0020).
func TestConsoleManagesTheMembersDevices(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		laptop := w.host(w.ada, "ada-laptop")
		pc := laptop.hostID()
		bobHost := w.host(w.bob, "bob-laptop").hostID()
		bobID := w.r.db.RelayHost.GetX(w.r.ctx, bobHost).UserID

		// Ada's phone pairs and attaches; this browser (keyB) pairs too.
		offer := laptop.ask(obj{"t": "offer"})["value"].(obj)["code"]
		_, body := w.call(w.adaPhone, "POST", "/relay/pair", obj{"code": offer, "deviceName": "Ada's phone"})
		phoneID := body["pairing"].(obj)["id"].(string)
		laptop.next(is("paired"))
		laptop.ask(obj{"t": "decide", "pairingId": phoneID, "accept": true})
		phone := w.phone(w.adaPhone)
		phone.send(sealed(phoneID, "attach"))
		laptop.next(is("sealed"))
		browserID := w.r.db.RelayPairing.Create().SetUserID(w.adaID).SetHostID(pc).SetDeviceName("Web browser").
			SetDeviceKeyHash(w.r.pairings.deviceHash(keyB)).SaveX(w.r.ctx).ID
		bobsPairing := w.paired(bobID, bobHost, true)

		status, listed := w.console(w.adaID, "GET", "/relay/hosts", keyB, false)
		if status != 200 {
			t.Fatalf("list %d %v", status, listed)
		}
		hosts := listed["hosts"].([]any)
		if len(hosts) != 1 {
			t.Fatalf("hosts %v", hosts)
		}
		h := hosts[0].(obj)
		equal(t, []any{h["id"], h["name"], h["dshVersion"], h["online"]}, []any{pc, "laptop", "0.2.2-rc.1", true})
		devices := map[string]obj{}
		for _, d := range h["pairings"].([]any) {
			devices[d.(obj)["id"].(string)] = d.(obj)
		}
		if len(devices) != 2 || devices[phoneID]["current"] != false || devices[browserID]["current"] != true ||
			devices[phoneID]["status"] != "confirmed" || devices[browserID]["status"] != "pending" {
			t.Fatalf("devices %v", devices)
		}

		// An app's Bearer may not list computers this way.
		if status, _ := w.call(w.adaPhone, "GET", "/relay/hosts", nil); status != 403 {
			t.Fatalf("app list %d", status)
		}
		// A revoke must come from this site: a cookie alone, cross-site, is nobody.
		if status, _ := w.console(w.adaID, "DELETE", "/relay/pairings/"+phoneID, "", false); status != 401 {
			t.Fatalf("cross-site revoke %d", status)
		}
		// Another member's device is out of reach, as is Bob's console over Ada's.
		if status, _ := w.console(w.adaID, "DELETE", "/relay/pairings/"+bobsPairing, keyB, true); status != 404 {
			t.Fatalf("other member's pairing %d", status)
		}
		if status, _ := w.console(bobID, "DELETE", "/relay/pairings/"+phoneID, "", true); status != 404 {
			t.Fatalf("other member's console %d", status)
		}
		_, bobs := w.console(bobID, "GET", "/relay/hosts", "", false)
		if got := bobs["hosts"].([]any); len(got) != 1 || got[0].(obj)["id"] != bobHost {
			t.Fatalf("bob sees %v", got)
		}

		// The console cuts off the phone, whose credential it does not hold: both ends hear at once.
		if status, _ := w.console(w.adaID, "DELETE", "/relay/pairings/"+phoneID, keyB, true); status != 204 {
			t.Fatalf("console revoke %d", status)
		}
		equal(t, phone.next(is("revoked")), obj{"t": "revoked", "pairingId": phoneID})
		equal(t, laptop.next(is("revoked")), obj{"t": "revoked", "pairingId": phoneID})
		_, left := w.call(w.adaPhone, "GET", "/relay/pairings", nil)
		equal(t, left["pairings"], []any{})
		_, listed = w.console(w.adaID, "GET", "/relay/hosts", keyB, false)
		if got := listed["hosts"].([]any)[0].(obj)["pairings"].([]any); len(got) != 1 || got[0].(obj)["id"] != browserID {
			t.Fatalf("after revoke %v", got)
		}
	})
}
