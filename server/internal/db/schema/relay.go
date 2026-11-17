package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"entgo.io/ent/schema/mixin"
)

// The relay's tables (docs/tech/relay.md, docs/tech/shared-dsh.md). Their
// indexes are named so as not to collide with those the hosted edition's own
// relay tables had, which an upgraded database holds until that edition drops
// them (ADR 0044). They name accounts and teams by id alone: the relay removes its rows when an account
// or a team goes (server/relay, teamChanged), in the deletion's own
// transaction.

func relayRef(name string) ent.Field { return field.String(name).NotEmpty().MaxLen(32) }

func relayAt(name string) ent.Field {
	return field.Time(name).SchemaType(mysqlTime).Optional().Nillable()
}

// created is Base without its id, for a table whose key is not a nanoid.
type created struct{ mixin.Schema }

func (created) Fields() []ent.Field {
	return []ent.Field{field.Time("created_at").SchemaType(mysqlTime).Default(now).Immutable()}
}

func (created) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Charset: "utf8mb4", Collation: "utf8mb4_bin"}}
}

// RelayHost is a member's DSH, as the teamwork plugin announces it on
// connecting to the relay. client_id is the id the plugin generated and keeps
// beside its cache, so one computer stays one host across restarts; it is
// unique per member only, since a plugin chooses it.
type RelayHost struct{ ent.Schema }

func (RelayHost) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (RelayHost) Fields() []ent.Field {
	return []ent.Field{
		relayRef("user_id"),
		field.String("client_id").NotEmpty().MaxLen(64),
		field.String("name").MaxLen(runes(100)),
		field.String("dsh_version").MaxLen(runes(40)),
		field.Time("last_seen_at").SchemaType(mysqlTime),
	}
}
func (RelayHost) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id", "client_id").Unique().StorageKey("relay_hosts_user_client")}
}

// RelayPairingOffer is a single-use pairing code a host asked for, shown in
// its Teamwork panel as a QR code. Only its HMAC under AUTH_SECRET is stored,
// as with sign-in codes.
type RelayPairingOffer struct{ ent.Schema }

func (RelayPairingOffer) Mixin() []ent.Mixin { return []ent.Mixin{created{}} }
func (RelayPairingOffer) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("code_hash").Immutable().NotEmpty().MaxLen(64),
		relayRef("host_id"),
		field.Time("expires_at").SchemaType(mysqlTime),
		relayAt("used_at"),
	}
}
func (RelayPairingOffer) Indexes() []ent.Index {
	return []ent.Index{index.Fields("host_id").StorageKey("relay_pairing_offers_host")}
}

// RelayPairing is a phone joined to one of its owner's hosts. It routes opaque
// records only from its owner's handset credential, including before
// confirmation. The desktop independently verifies the phone's device identity
// before business traffic. Revocation blocks routing; an unbound row grants no
// access.
type RelayPairing struct{ ent.Schema }

func (RelayPairing) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (RelayPairing) Fields() []ent.Field {
	return []ent.Field{
		relayRef("user_id"),
		relayRef("host_id"),
		field.String("device_name").MaxLen(runes(100)),
		field.String("device_key_hash").MaxLen(64).Optional().Nillable(),
		// The phone's Expo push token, and the language its notifications are written in.
		field.String("push_token").MaxLen(200).Optional().Nillable(),
		field.String("push_locale").MaxLen(20).Optional().Nillable(),
		relayAt("confirmed_at"),
		relayAt("revoked_at"),
		relayAt("last_used_at"),
	}
}
func (RelayPairing) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id").StorageKey("relay_pairings_user"), index.Fields("host_id").StorageKey("relay_pairings_host")}
}

// SharedHost is a DSH a team shares with its members (docs/tech/shared-dsh.md,
// ADR 0044): created by a team admin, it belongs to the team and to no person.
// Its key is shown once; only its HMAC under AUTH_SECRET is stored.
// identity_key is the DSH's Ed25519 public key, bound by the first exchange;
// every later exchange must be signed by it.
type SharedHost struct{ ent.Schema }

func (SharedHost) Mixin() []ent.Mixin { return []ent.Mixin{Base{}} }
func (SharedHost) Fields() []ent.Field {
	return []ent.Field{
		relayRef("team_id"),
		field.String("name").NotEmpty().MaxLen(runes(100)),
		field.String("key_hash").NotEmpty().MaxLen(64),
		field.String("identity_key").MaxLen(64).Optional().Nillable(),
		relayRef("created_by"),
		relayAt("bound_at"),
		relayAt("last_seen_at"),
	}
}
func (SharedHost) Indexes() []ent.Index {
	return []ent.Index{index.Fields("team_id").StorageKey("shared_hosts_team")}
}
