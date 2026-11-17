package relay

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relayhost"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
)

func TestDeletedAccountLeavesNoComputersOrPhones(t *testing.T) {
	each(t, func(t *testing.T, w *world) {
		ctx := context.Background()
		ada := w.host(w.ada, "ada-laptop").hostID()
		bob := w.host(w.bob, "bob-laptop").hostID()
		w.paired(w.adaID, ada, true)
		w.paired(w.r.db.RelayHost.GetX(ctx, bob).UserID, bob, true)
		if _, err := w.r.pairings.offer(ctx, ada, time.Now()); err != nil {
			t.Fatal(err)
		}

		r, _ := http.NewRequest("DELETE", w.in.URL+"/api/profile", strings.NewReader(`{"confirm":"ada@example.test"}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", w.in.URL)
		r.AddCookie(w.in.Session(w.adaID, "email"))
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 204 {
			t.Fatalf("delete: %d", res.StatusCode)
		}

		if n := w.r.db.RelayHost.Query().Where(relayhost.UserID(w.adaID)).CountX(ctx); n != 0 {
			t.Fatalf("%d of the deleted account's computers remain", n)
		}
		if n := w.r.db.RelayPairing.Query().Where(relaypairing.Or(relaypairing.UserID(w.adaID), relaypairing.HostID(ada))).CountX(ctx); n != 0 {
			t.Fatalf("%d of its pairings remain", n)
		}
		if n := w.r.db.RelayPairingOffer.Query().CountX(ctx); n != 0 {
			t.Fatalf("%d pairing codes remain", n)
		}
		if n := w.r.db.RelayPairing.Query().Where(relaypairing.HostID(bob)).CountX(ctx); n != 1 {
			t.Fatalf("another member's pairing went too: %d", n)
		}
	})
}
