package relay

// What the relay says to the teamwork plugin on /relay/plugin and to the app
// on /relay/phone (docs/tech/relay.md, "Frames"). The plugin's
// repository restates it in `src/relay.ts` and `src/bridge.ts`, and the app
// in `premium/apps/mobile/lib/relay/`; a change here changes them in the same
// working session.

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
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
	DeviceKey  *string `json:"deviceKey"`
	T          string  `json:"t"`
	Token      *string `json:"token"`
	ClientID   *string `json:"clientId"`
	Name       *string `json:"name"`
	DSHVersion *string `json:"dshVersion"`
	ID         *string `json:"id"`
	PairingID  *string `json:"pairingId"`
	Accept     *bool   `json:"accept"`
	ChannelID  *string `json:"channelId"`
	Data       *string `json:"data"`
	Kind       *string `json:"kind"`
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
// computer.
type hello struct{ token, clientID, name, dshVersion string }

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
	return hello{token: *f.Token, clientID: *f.ClientID, name: name, dshVersion: version}, true
}

type phoneHello struct{ token, deviceKey string }

func validDeviceKey(key string) bool { return deviceKeyPattern.MatchString(key) }

func parsePhoneHello(data []byte) (phoneHello, bool) {
	f, ok := parse(data)
	if !ok || f.T != "hello" || !str(f.Token, 1, 1<<20) || f.DeviceKey == nil || !validDeviceKey(*f.DeviceKey) {
		return phoneHello{}, false
	}
	return phoneHello{token: *f.Token, deviceKey: *f.DeviceKey}, true
}

// pluginRequest is what a plugin asks after its welcome; id pairs it with
// the reply. offer: a fresh pairing code. pairings: this host's phones.
// decide: confirm or refuse a pending phone. revoke: cut one off.
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
	case "offer", "pairings":
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

// forwarded carries opaque encryption records, including initial verification for pending pairings.
// The plugin independently authenticates devices before any business request reaches DSH.
type forwarded struct {
	T         string `json:"t"`
	PairingID string `json:"pairingId"`
	ChannelID string `json:"channelId"`
	Kind      string `json:"kind"`
	Data      string `json:"data"`
}

func parsePhoneFrame(f *frame) (forwarded, bool) {
	if f.T != "sealed" || !str(f.PairingID, 1, 64) || !str(f.ChannelID, 22, 22) || !clientIDPattern.MatchString(*f.ChannelID) ||
		f.Kind == nil || (*f.Kind != "commit" && *f.Kind != "reveal" && *f.Kind != "noise" && *f.Kind != "data") || !str(f.Data, 1, 700000) {
		return forwarded{}, false
	}
	return forwarded{T: "sealed", PairingID: *f.PairingID, ChannelID: *f.ChannelID, Kind: *f.Kind, Data: *f.Data}, true
}

func parseHostFrame(f *frame) (forwarded, bool) { return parsePhoneFrame(f) }

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
