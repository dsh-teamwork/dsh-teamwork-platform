package relay

// Push notifications (docs/tech/relay.md, "Push
// notifications"): when a plugin reports that its agent waits on the member,
// every confirmed phone of that computer that is not connected right now, and
// gave a push token when it paired, is told so through Expo's push service.
//
// A notification names the computer and nothing of the question, which would
// otherwise pass through Expo, Apple and Google. Its data carries the pairing
// id only, so tapping selects the computer and reads its pending work securely.

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
)

//go:embed messages/*.json
var messageFiles embed.FS

// messages is what a notification says, by locale: "question" and "approval",
// each with {computer} in it.
var messages = func() map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, locale := range []string{"en", "zh-CN"} {
		b, err := messageFiles.ReadFile("messages/" + locale + ".json")
		if err != nil {
			panic(err)
		}
		m := map[string]string{}
		if err := json.Unmarshal(b, &m); err != nil {
			panic(err)
		}
		out[locale] = m
	}
	return out
}()

// pushLocale is the language a phone asked for, as the product ships them:
// any Chinese tag reads zh-CN, everything else English.
func pushLocale(tag *string) string {
	if tag != nil && strings.HasPrefix(strings.ToLower(*tag), "zh") {
		return "zh-CN"
	}
	return "en"
}

// pushQuiet is how long a session that just notified a phone stays quiet, so
// a burst of waits is one buzz.
const pushQuiet = time.Minute

// PushMessage is one message for Expo's push API
// (https://docs.expo.dev/push-notifications/sending-notifications/).
type PushMessage struct {
	To    string            `json:"to"`
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Data  map[string]string `json:"data"`
	Sound string            `json:"sound"`
}

// SendPush hands messages to Expo; tests pass a recorder.
type SendPush func(ctx context.Context, messages []PushMessage) error

type notifier struct {
	db   *ent.Client
	send SendPush
	mu   sync.Mutex
	last map[string]time.Time // by pairing id and session id
}

func (n *notifier) notify(ctx context.Context, hostID string, w waiting, connected func(pairingID string) bool, now time.Time) error {
	host, err := n.db.RelayHost.Get(ctx, hostID)
	if ent.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	rows, err := n.db.RelayPairing.Query().Where(
		relaypairing.HostID(hostID), relaypairing.ConfirmedAtNotNil(),
		relaypairing.RevokedAtIsNil(), relaypairing.PushTokenNotNil(),
	).All(ctx)
	if err != nil {
		return err
	}
	var out []PushMessage
	n.mu.Lock()
	for _, p := range rows {
		if connected(p.ID) {
			continue
		}
		key := p.ID
		if last, ok := n.last[key]; ok && now.Sub(last) < pushQuiet {
			continue
		}
		n.last[key] = now
		text := messages[pushLocale(p.PushLocale)]["waiting"]
		out = append(out, PushMessage{
			To: *p.PushToken, Title: host.Name, Body: strings.ReplaceAll(text, "{computer}", host.Name),
			Data: map[string]string{"pairingId": p.ID}, Sound: "default",
		})
	}
	// Entries past the quiet window are forgotten, so the map stays the size
	// of the last minute's notifications.
	for key, at := range n.last {
		if now.Sub(at) >= pushQuiet {
			delete(n.last, key)
		}
	}
	n.mu.Unlock()
	if len(out) == 0 {
		return nil
	}
	return n.send(ctx, out)
}

var expoClient = &http.Client{Timeout: 10 * time.Second}

// throughExpo is Expo's push service, which forwards to Apple and Google.
func throughExpo(ctx context.Context, messages []PushMessage) error {
	body, err := json.Marshal(messages)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", "https://exp.host/--/api/v2/push/send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	res, err := expoClient.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("expo push failed (%d)", res.StatusCode)
	}
	return nil
}
