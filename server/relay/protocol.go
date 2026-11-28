package relay

// What the relay says to the teamwork plugin on /relay/plugin and to the app
// on /relay/phone (docs/tech/relay.md, "Frames"). The plugin's
// repository restates it in `src/relay.ts` and `src/bridge.ts`, and the
// clients in `packages/relay-client/src/protocol.ts`; a change here changes
// them in the same working session.

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relayhost"
)

// helloTimeout is how long a socket has to send its hello; tests shorten it.
var helloTimeout = 5 * time.Second

const (
	// maxFrameBytes is the largest frame either side sends; a larger one
	// closes the socket.
	maxFrameBytes = 1024 * 1024
	maxBodyBytes  = 16 * 1024
	// rateLimit is how many frames a phone may send per pairing within
	// rateWindow. Only the phone's side is counted: what comes back is the
	// member's own computer answering.
	rateLimit  = 300
	rateWindow = 10 * time.Second
)

// Close codes either side acts on: it reconnects after any other.
const (
	closeBadHello     = 4400 // malformed hello, or none in time
	closeUnauthorized = 4401 // the token is not a member's: sign in again first
	closeReplaced     = 4409 // the same computer connected again; this socket is stale
	closeTooSlow      = 4408 // the peer reads more slowly than frames arrive for it
)

var (
	deviceKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	clientIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	pushTokenPattern = regexp.MustCompile(`^Expo(nent)?PushToken\[[^\]]+\]$`)
)

// length counts as JavaScript does, in UTF-16 units, so a limit means what
// the plugin's and the app's own checks mean.
func length(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func between(s string, min, max int) bool {
	n := length(s)
	return utf8.ValidString(s) && n >= min && n <= max
}

// frame is every field any frame carries; which ones a frame must have
// depends on its t. A field absent stays nil.
type frame struct {
	Web        bool    `json:"web"`
	DeviceKey  *string `json:"deviceKey"`
	T          string  `json:"t"`
	Token      *string `json:"token"`
	ClientID   *string `json:"clientId"`
	Name       *string `json:"name"`
	DSHVersion *string `json:"dshVersion"`
	Plugin     *string `json:"pluginVersion"`
	OS         *string `json:"os"`
	ID         *string `json:"id"`
	PairingID  *string `json:"pairingId"`
	Accept     *bool   `json:"accept"`
}

func parse(data []byte) (*frame, bool) {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var f frame
	if err := d.Decode(&f); err != nil {
		return nil, false
	}
	return &f, true
}

func str(p *string, min, max int) bool { return p != nil && between(*p, min, max) }

func trimmed(p *string, min, max int) (string, bool) {
	if p == nil {
		return "", false
	}
	s := strings.TrimSpace(*p)
	return s, between(s, min, max)
}

// hello is the first frame on a plugin socket: who is connecting, from which
// computer. os and pluginVersion are nil from a plugin too old to report them.
type hello struct {
	web                               bool
	token, clientID, name, dshVersion string
	pluginVersion                     *string
	os                                *relayhost.Os
}

func parseHello(data []byte) (hello, bool) {
	f, ok := parse(data)
	if !ok || f.T != "hello" || !str(f.Token, 1, 1<<20) || !str(f.ClientID, 8, 64) || !clientIDPattern.MatchString(*f.ClientID) {
		return hello{}, false
	}
	name, ok1 := trimmed(f.Name, 1, 100)
	version, ok2 := trimmed(f.DSHVersion, 1, 40)
	if !ok1 || !ok2 {
		return hello{}, false
	}
	h := hello{web: f.Web, token: *f.Token, clientID: *f.ClientID, name: name, dshVersion: version}
	if f.Plugin != nil {
		plugin, ok := trimmed(f.Plugin, 1, 40)
		if !ok {
			return hello{}, false
		}
		h.pluginVersion = &plugin
	}
	if f.OS != nil {
		os := relayhost.Os(*f.OS)
		if relayhost.OsValidator(os) != nil {
			return hello{}, false
		}
		h.os = &os
	}
	return h, true
}

type phoneHello struct{ token, deviceKey string }

func validDeviceKey(key string) bool { return deviceKeyPattern.MatchString(key) }

func parsePhoneHello(data []byte) (phoneHello, bool) {
	f, ok := parse(data)
	// A browser sends no token: its session cookie came with the upgrade.
	if !ok || f.T != "hello" || (f.Token != nil && !str(f.Token, 1, 1<<20)) || f.DeviceKey == nil || !validDeviceKey(*f.DeviceKey) {
		return phoneHello{}, false
	}
	h := phoneHello{deviceKey: *f.DeviceKey}
	if f.Token != nil {
		h.token = *f.Token
	}
	return h, true
}

// pluginRequest is what a plugin asks after its welcome; id pairs it with
// the reply. offer: a fresh pairing code. pairings: this host's phones.
// decide: confirm or refuse a pending phone. revoke: cut one off. webRevoke:
// end every native Web session of this computer (ADR 0065).
type pluginRequest struct {
	t, id, pairingID string
	accept           bool
}

func parsePluginRequest(f *frame) (pluginRequest, bool) {
	if !str(f.ID, 1, 64) {
		return pluginRequest{}, false
	}
	r := pluginRequest{t: f.T, id: *f.ID}
	switch f.T {
	case "offer", "pairings", "webRevoke":
		return r, true
	case "decide":
		if !str(f.PairingID, 1, 1<<20) || f.Accept == nil {
			return pluginRequest{}, false
		}
		r.pairingID, r.accept = *f.PairingID, *f.Accept
		return r, true
	case "revoke":
		if !str(f.PairingID, 1, 1<<20) {
			return pluginRequest{}, false
		}
		r.pairingID = *f.PairingID
		return r, true
	}
	return pluginRequest{}, false
}

// sealedRecord is one encryption record between a phone and its computer, in a
// binary WebSocket message the relay passes on byte for byte
// (docs/tech/relay.md, "Frames"): a kind byte (sealedKinds), the pairing id's
// length in one byte, the pairing id, the 22-character channel id, and the
// record itself. The relay reads the header only; what follows is ciphertext
// or a handshake message, never parsed here.
type sealedRecord struct {
	PairingID string
	frame     []byte
}

// sealedKinds are commit, reveal, noise and data, in that order.
const sealedKinds = 4

// maxSealedBytes is the longest record a sealed frame carries: a channel
// packet is at most 384 KiB, and a Noise flight far less.
const maxSealedBytes = 512 * 1024

var pairingIDPattern = regexp.MustCompile(`^[\x21-\x7e]{1,64}$`)

func parseSealed(data []byte) (sealedRecord, bool) {
	if len(data) < 2 || data[0] < 1 || data[0] > sealedKinds {
		return sealedRecord{}, false
	}
	n := int(data[1])
	head := 2 + n + 22
	if n < 1 || n > 64 || len(data) <= head || len(data)-head > maxSealedBytes {
		return sealedRecord{}, false
	}
	pairingID, channelID := string(data[2:2+n]), string(data[2+n:head])
	if !pairingIDPattern.MatchString(pairingID) || !clientIDPattern.MatchString(channelID) {
		return sealedRecord{}, false
	}
	return sealedRecord{PairingID: pairingID, frame: data}, true
}

// pong answers a `ping` from either end at once. A WebSocket's own pings
// are the relay's to send and a browser cannot send one, so each end checks
// that its socket still carries frames with this pair: a socket left half
// open by a network change is found within seconds, not at a call's timeout.
var pong = map[string]string{"t": "pong"}

type waiting struct{}

func parseWaiting(f *frame) (waiting, bool) { return waiting{}, f.T == "waiting" }

// pushUpdate is `PUT /relay/pairings/{id}/push`, from a phone: a token turns
// the pairing's notifications on, `null` turns them off.
type pushUpdate struct{ token, locale *string }

func parsePushUpdate(data []byte) (pushUpdate, bool) {
	var in struct {
		PushToken json.RawMessage `json:"pushToken"`
		Locale    *string         `json:"locale"`
	}
	if err := json.Unmarshal(data, &in); err != nil || len(in.PushToken) == 0 {
		return pushUpdate{}, false
	}
	if string(in.PushToken) == "null" {
		return pushUpdate{}, true
	}
	var token string
	if err := json.Unmarshal(in.PushToken, &token); err != nil || length(token) > 200 || !pushTokenPattern.MatchString(token) {
		return pushUpdate{}, false
	}
	if in.Locale != nil && length(*in.Locale) > 20 {
		return pushUpdate{}, false
	}
	return pushUpdate{token: &token, locale: in.Locale}, true
}

// redeem is `POST /relay/pair`, from a phone. Notifications are turned on
// afterwards, once the pairing is confirmed (`PUT /relay/pairings/{id}/push`).
type redeem struct{ code, deviceName string }

func parseRedeem(data []byte) (redeem, bool) {
	var in struct {
		Code       *string `json:"code"`
		DeviceName *string `json:"deviceName"`
	}
	if err := json.Unmarshal(data, &in); err != nil {
		return redeem{}, false
	}
	code, ok1 := trimmed(in.Code, 6, 6)
	device, ok2 := trimmed(in.DeviceName, 1, 100)
	if !ok1 || !ok2 {
		return redeem{}, false
	}
	return redeem{code: code, deviceName: device}, true
}
