package relay

// Pairing (docs/tech/relay.md, "Pairing"): a host asks for a
// single-use code, a phone of the same member redeems it, and the member
// confirms the phone on the computer. A pairing reaches nothing until
// locally verified by the desktop; relay revocation stops even handshake traffic.

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/predicate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relayhost"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairing"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/relaypairingoffer"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/sharedhost"
)

const offerTTL = 2 * time.Minute

// codeAlphabet has no 0/O or 1/I/L: the code is also read off a screen and typed.
const (
	codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ"
	codeLength   = 6
)

// rejected is a pairing refusal the caller is told: "invalid_code" or "not_found".
type rejected string

func (r rejected) Error() string { return string(r) }

const (
	errInvalidCode rejected = "invalid_code"
	errNotFound    rejected = "not_found"
)

// pairingView is a pairing as the plugin and the app read it.
type pairingView struct {
	ID     string `json:"id"`
	HostID string `json:"hostId"`
	// UserID is the member whose handset it is: a shared DSH checks a joining
	// member's invite against it.
	UserID     string  `json:"userId"`
	HostName   string  `json:"hostName"`
	DeviceName string  `json:"deviceName"`
	Status     string  `json:"status"` // pending or confirmed
	CreatedAt  string  `json:"createdAt"`
	LastUsedAt *string `json:"lastUsedAt"`
	// Online is set only on a phone's list: whether its computer is connected.
	Online *bool `json:"online,omitempty"`
	// Push is set only on a phone's list: whether this pairing notifies it. The token never leaves the relay.
	Push *bool `json:"push,omitempty"`
}

// iso is a time as JavaScript's toISOString writes it.
func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func view(p *ent.RelayPairing, hostName string) pairingView {
	v := pairingView{ID: p.ID, HostID: p.HostID, UserID: p.UserID, HostName: hostName, DeviceName: p.DeviceName, Status: "pending", CreatedAt: iso(p.CreatedAt)}
	if p.ConfirmedAt != nil {
		v.Status = "confirmed"
	}
	if p.LastUsedAt != nil {
		s := iso(*p.LastUsedAt)
		v.LastUsedAt = &s
	}
	return v
}

func normalizeCode(code string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(code) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

type pairings struct {
	db     *ent.Client
	secret string
}

func (p *pairings) hash(code string) string {
	return p.mac("relay-pairing", normalizeCode(code))
}

func (p *pairings) mac(purpose, value string) string {
	m := hmac.New(sha256.New, []byte(p.secret))
	m.Write([]byte(purpose + ":" + value))
	return hex.EncodeToString(m.Sum(nil))
}

func (p *pairings) deviceHash(key string) string { return p.mac("relay-device", key) }

// Account authentication alone cannot enumerate, revoke or take over another handset's pairing.
type phone struct{ userID, deviceHash string }

func (ph phone) where() predicate.RelayPairing {
	return relaypairing.And(relaypairing.UserID(ph.userID), relaypairing.DeviceKeyHash(ph.deviceHash))
}

type offer struct {
	Code      string `json:"code"`
	ExpiresAt string `json:"expiresAt"`
}

// offer is a fresh code for one host; its earlier unused codes stop working.
func (p *pairings) offer(ctx context.Context, hostID string, now time.Time) (offer, error) {
	for range 5 {
		var b strings.Builder
		for range codeLength {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
			if err != nil {
				return offer{}, err
			}
			b.WriteByte(codeAlphabet[n.Int64()])
		}
		code, expires := b.String(), now.Add(offerTTL)
		err := withTx(ctx, p.db, func(tx *ent.Tx) error {
			if _, err := tx.RelayPairingOffer.Delete().Where(relaypairingoffer.HostID(hostID), relaypairingoffer.UsedAtIsNil()).Exec(ctx); err != nil {
				return err
			}
			return tx.RelayPairingOffer.Create().SetID(p.hash(code)).SetHostID(hostID).SetExpiresAt(expires).SetCreatedAt(now).Exec(ctx)
		})
		if ent.IsConstraintError(err) {
			continue
		}
		return offer{Code: code, ExpiresAt: iso(expires)}, err
	}
	return offer{}, errors.New("could not allocate a unique pairing code")
}

// redeem is a phone redeeming a code. The code must be live and unused, and
// its host must belong to the caller: a code shown on someone else's computer
// pairs nothing. The pairing starts pending.
func (p *pairings) redeem(ctx context.Context, ph phone, in redeem, now time.Time) (pairingView, error) {
	codeHash := p.hash(in.code)
	var out pairingView
	err := withTx(ctx, p.db, func(tx *ent.Tx) error {
		o, err := tx.RelayPairingOffer.Get(ctx, codeHash)
		if ent.IsNotFound(err) {
			return errInvalidCode
		}
		if err != nil {
			return err
		}
		if o.UsedAt != nil || !o.ExpiresAt.After(now) {
			return errInvalidCode
		}
		host, err := tx.RelayHost.Get(ctx, o.HostID)
		if ent.IsNotFound(err) || (err == nil && host.UserID != ph.userID) {
			return errInvalidCode
		}
		if err != nil {
			return err
		}
		// Spent before anything else can see it, so a second redeem of the same code fails.
		n, err := tx.RelayPairingOffer.Update().Where(relaypairingoffer.ID(codeHash), relaypairingoffer.UsedAtIsNil()).SetUsedAt(now).Save(ctx)
		if err != nil {
			return err
		}
		if n != 1 {
			return errInvalidCode
		}
		pairing, err := tx.RelayPairing.Create().SetUserID(ph.userID).SetHostID(host.ID).SetDeviceName(in.deviceName).
			SetDeviceKeyHash(ph.deviceHash).SetCreatedAt(now).Save(ctx)
		if err != nil {
			return err
		}
		out = view(pairing, host.Name)
		return nil
	})
	return out, err
}

// decide is the member confirming or refusing a pending phone, from the host it belongs to.
func (p *pairings) decide(ctx context.Context, hostID, pairingID string, accept bool, now time.Time) error {
	up := p.db.RelayPairing.Update().Where(
		relaypairing.ID(pairingID), relaypairing.HostID(hostID),
		relaypairing.ConfirmedAtIsNil(), relaypairing.RevokedAtIsNil(),
	)
	if accept {
		up.SetConfirmedAt(now)
	} else {
		up.SetRevokedAt(now)
	}
	n, err := up.Save(ctx)
	if err == nil && n != 1 {
		return errNotFound
	}
	return err
}

// Scope has two real callers: a specific handset, or one authenticated desktop host.
type scope interface{ where() predicate.RelayPairing }

type host string

func (h host) where() predicate.RelayPairing { return relaypairing.HostID(string(h)) }

// revoke ends a pairing from either side, and returns the host it joined.
func (p *pairings) revoke(ctx context.Context, s scope, pairingID string, now time.Time) (string, error) {
	n, err := p.db.RelayPairing.Update().Where(relaypairing.ID(pairingID), relaypairing.RevokedAtIsNil(), s.where()).SetRevokedAt(now).Save(ctx)
	if err != nil {
		return "", err
	}
	if n != 1 {
		return "", errNotFound
	}
	pairing, err := p.db.RelayPairing.Get(ctx, pairingID)
	if err != nil {
		return "", err
	}
	return pairing.HostID, nil
}

// use is a phone starting to use a pairing: it must be the caller's,
// unrevoked. Pending devices exchange only opaque handshake records until the
// desktop independently verifies them. It records the use and returns the host.
func (p *pairings) use(ctx context.Context, ph phone, pairingID string, now time.Time) (string, error) {
	n, err := p.db.RelayPairing.Update().Where(
		relaypairing.ID(pairingID), ph.where(),
		relaypairing.RevokedAtIsNil(),
	).SetLastUsedAt(now).Save(ctx)
	if err != nil {
		return "", err
	}
	if n != 1 {
		return "", errNotFound
	}
	pairing, err := p.db.RelayPairing.Get(ctx, pairingID)
	if err != nil {
		return "", err
	}
	return pairing.HostID, nil
}

// list is the live pairings of one handset or of one host, newest first.
func (p *pairings) list(ctx context.Context, s scope) ([]pairingView, error) {
	rows, err := p.db.RelayPairing.Query().Where(relaypairing.RevokedAtIsNil(), s.where()).
		Order(ent.Desc(relaypairing.FieldCreatedAt), ent.Desc(relaypairing.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for _, r := range rows {
		ids[r.HostID] = true
	}
	hostIDs := make([]string, 0, len(ids))
	for id := range ids {
		hostIDs = append(hostIDs, id)
	}
	hosts, err := p.db.RelayHost.Query().Where(relayhost.IDIn(hostIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for _, h := range hosts {
		names[h.ID] = h.Name
	}
	shared, err := p.db.SharedHost.Query().Where(sharedhost.IDIn(hostIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, h := range shared {
		names[h.ID] = h.Name
	}
	_, toPhone := s.(phone)
	out := make([]pairingView, len(rows))
	for i, r := range rows {
		out[i] = view(r, names[r.HostID])
		if toPhone {
			push := r.PushToken != nil
			out[i].Push = &push
		}
	}
	return out, nil
}

// setPush is a phone turning one pairing's notifications on, with its current
// token and language, or off. Only the handset the pairing is bound to, on the
// same account, reaches it, and a revoked pairing is not found.
func (p *pairings) setPush(ctx context.Context, ph phone, pairingID string, in pushUpdate) error {
	up := p.db.RelayPairing.Update().Where(relaypairing.ID(pairingID), ph.where(), relaypairing.RevokedAtIsNil())
	switch {
	case in.token == nil:
		up.ClearPushToken().ClearPushLocale()
	case in.locale == nil:
		up.SetPushToken(*in.token).ClearPushLocale()
	default:
		up.SetPushToken(*in.token).SetPushLocale(*in.locale)
	}
	n, err := up.Save(ctx)
	if err == nil && n != 1 {
		return errNotFound
	}
	return err
}

func withTx(ctx context.Context, db *ent.Client, f func(*ent.Tx) error) error {
	tx, err := db.Tx(ctx)
	if err != nil {
		return err
	}
	if err := f(tx); err != nil {
		if rerr := tx.Rollback(); rerr != nil {
			return errors.Join(err, rerr)
		}
		return err
	}
	return tx.Commit()
}
