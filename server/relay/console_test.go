package relay

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relayhost"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairingoffer"
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
		equal(t, []any{h["id"], h["name"], h["dshVersion"], h["pluginVersion"], h["os"], h["online"]}, []any{pc, "laptop", "0.2.2-rc.1", "0.18.0", "macos", true})
		devices := map[string]obj{}
		for _, d := range h["pairings"].([]any) {
			devices[d.(obj)["id"].(string)] = d.(obj)
		}
		if len(devices) != 2 || devices[phoneID]["current"] != false || devices[browserID]["current"] != true ||
			devices[phoneID]["status"] != "confirmed" || devices[browserID]["status"] != "pending" {
			t.Fatalf("devices %v", devices)
		}

		// The app lists the same computers, to pair with any of them, but sees only its own handset's pairings.
		status, fromPhone := w.call(w.adaPhone, "GET", "/relay/hosts", nil)
		if status != 200 {
			t.Fatalf("app list %d %v", status, fromPhone)
		}
		phoneHosts := fromPhone["hosts"].([]any)
		if len(phoneHosts) != 1 || phoneHosts[0].(obj)["id"] != pc {
			t.Fatalf("app hosts %v", phoneHosts)
		}
		if got := phoneHosts[0].(obj)["pairings"].([]any); len(got) != 1 || got[0].(obj)["id"] != phoneID || got[0].(obj)["current"] != true {
			t.Fatalf("app sees pairings %v", got)
		}
		// Another handset of the same account sees the computer and none of these pairings; a Bearer needs its handset.
		_, other := w.call(handset{w.ada, strings.Repeat("C", 43)}, "GET", "/relay/hosts", nil)
		if got := other["hosts"].([]any); len(got) != 1 || len(got[0].(obj)["pairings"].([]any)) != 0 {
			t.Fatalf("another handset sees %v", got)
		}
		if status, _ := w.call(handset{w.ada, ""}, "GET", "/relay/hosts", nil); status != 400 {
			t.Fatalf("app list without its handset %d", status)
		}
		if _, bobsPhone := w.call(w.bobPhone, "GET", "/relay/hosts", nil); len(bobsPhone["hosts"].([]any)) != 1 || bobsPhone["hosts"].([]any)[0].(obj)["id"] != bobHost {
			t.Fatalf("bob's phone sees %v", bobsPhone)
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

// The web console signs one of the member's own computers out and forgets it
// (ADR 0060), connected or not, with its pairing codes and every pairing to
// it: its socket closes at once and the sign-in it connected with opens
// nothing, while the member's other sign-ins stay. It reaches no other
// member's computer, and an app's token reaches none.
func TestConsoleDeletesAComputer(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		laptopToken := w.in.Bearer(w.adaID) // its own sign-in, apart from the phone's
		laptop := w.host(laptopToken, "ada-laptop")
		pc := laptop.hostID()
		laptop.ask(obj{"t": "offer"})
		phoneID := w.paired(w.adaID, pc, true)
		phone := w.phone(w.adaPhone)
		phone.send(sealed(phoneID, "open"))
		laptop.next(is("sealed")) // the phone is attached to the connected computer
		bobHost := w.host(w.bob, "bob-laptop").hostID()
		bobID := w.r.db.RelayHost.GetX(w.r.ctx, bobHost).UserID

		if status, _ := w.call(w.adaPhone, "DELETE", "/relay/hosts/"+pc, nil); status != 403 {
			t.Fatalf("app delete %d", status)
		}
		if status, _ := w.console(w.adaID, "DELETE", "/relay/hosts/"+pc, "", false); status != 401 {
			t.Fatalf("cross-site delete %d", status)
		}
		if status, _ := w.console(bobID, "DELETE", "/relay/hosts/"+pc, "", true); status != 404 {
			t.Fatalf("other member's computer %d", status)
		}

		if status, _ := w.console(w.adaID, "DELETE", "/relay/hosts/"+pc, "", true); status != 204 {
			t.Fatalf("delete %d", status)
		}
		equal(t, phone.next(is("revoked")), obj{"t": "revoked", "pairingId": phoneID})
		select {
		case <-laptop.closed:
		case <-time.After(3 * time.Second):
			t.Fatal("the computer stayed connected after it was removed")
		}
		if laptop.ended != closeUnauthorized {
			t.Fatalf("removed computer closed with %d", laptop.ended)
		}
		if code := w.host(laptopToken, "ada-laptop").code; code != closeUnauthorized {
			t.Fatalf("the removed computer's sign-in reconnected: %d", code)
		}
		if status, _ := w.call(w.adaPhone, "GET", "/relay/pairings", nil); status != 200 {
			t.Fatalf("the phone's own sign-in went with the computer: %d", status)
		}
		if w.r.db.RelayHost.Query().Where(relayhost.ID(pc)).ExistX(w.r.ctx) ||
			w.r.db.RelayPairing.Query().Where(relaypairing.HostID(pc)).ExistX(w.r.ctx) ||
			w.r.db.RelayPairingOffer.Query().Where(relaypairingoffer.HostID(pc)).ExistX(w.r.ctx) {
			t.Fatal("rows of the deleted computer are left behind")
		}
		_, listed := w.console(w.adaID, "GET", "/relay/hosts", "", false)
		equal(t, listed["hosts"], []any{})
		if status, _ := w.console(w.adaID, "DELETE", "/relay/hosts/"+pc, "", true); status != 404 {
			t.Fatalf("deleted twice %d", status)
		}

		// The same computer coming back is recorded anew, with nothing paired.
		again := w.host(w.ada, "ada-laptop").hostID()
		if again == pc {
			t.Fatal("the computer came back under its old id")
		}
	})
}

// The web console renames one of the member's own computers, and the name
// holds when the computer connects again announcing its own. It reaches no
// other member's computer, an app's token renames none, and a name is 1 to 100
// characters once trimmed.
func TestConsoleRenamesAComputer(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		pc := w.host(w.ada, "ada-laptop").hostID()
		bobHost := w.host(w.bob, "bob-laptop").hostID()
		bobID := w.r.db.RelayHost.GetX(w.r.ctx, bobHost).UserID
		rename := func(userID, id, name string) int {
			t.Helper()
			body, _ := json.Marshal(obj{"name": name})
			req, _ := http.NewRequest("PATCH", w.in.URL+"/relay/hosts/"+id, bytes.NewReader(body))
			req.AddCookie(w.in.Session(userID, "password"))
			req.Header.Set("Origin", w.in.URL)
			req.Header.Set("Content-Type", "application/json")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			return res.StatusCode
		}

		if status, _ := w.call(w.adaPhone, "PATCH", "/relay/hosts/"+pc, obj{"name": "Studio"}); status != 403 {
			t.Fatalf("app rename %d", status)
		}
		if status := rename(bobID, pc, "Studio"); status != 404 {
			t.Fatalf("other member's computer %d", status)
		}
		for _, bad := range []string{"  ", strings.Repeat("x", 101)} {
			if status := rename(w.adaID, pc, bad); status != 400 {
				t.Fatalf("name %q: %d", bad, status)
			}
		}
		if status := rename(w.adaID, pc, "  Studio Mac  "); status != 204 {
			t.Fatalf("rename %d", status)
		}
		w.host(w.ada, "ada-laptop") // the computer connects again, announcing "laptop"
		_, listed := w.console(w.adaID, "GET", "/relay/hosts", "", false)
		if got := listed["hosts"].([]any)[0].(obj)["name"]; got != "Studio Mac" {
			t.Fatalf("after reconnecting: %v", got)
		}
		if got := w.r.db.RelayHost.GetX(w.r.ctx, bobHost).Name; got != "laptop" {
			t.Fatalf("bob's computer: %q", got)
		}
	})
}
