# 0044. The relay and shared DSHs are open

> **Status:** Accepted — its shared DSH superseded by 0067 · **Date:** 2026-11-17

## Context

ADR 0005 splits the product by who needs it: what one team needs is open and
self-hosted, what a company needs to govern is closed. The hosted edition then
built a relay as closed code: a DSH and a phone each hold a socket to the
server, pair once, and exchange end-to-end encrypted records the server
forwards without reading (Noise XX between pinned Ed25519 device keys, then
AES-GCM records; a handset credential for admission). It reached only a
member's own computer, from a closed app that signs in to the hosted service
alone.

A team now shares one DSH it runs itself (`docs/tech/shared-dsh.md`):
an admin signs it in with a team host key, members reach it through the relay
by invite, each session belongs to its starter, a PIN locks each member's
access, and the DSH writes an archive sealed to a key only the admin holds.
That is something one team needs, and the developer decided it must work on a
self-hosted community server. It cannot without the relay, and a second relay
beside the closed one would be the same code twice.

## Decision

**The relay, shared DSHs and their archive are part of the open server; the
community edition has them with no hosted account.**

- **The whole relay moves into the open server**: the plugin's and the
  phone's sockets, pairing, the handset credential, opaque forwarding, push
  notifications through Expo's public endpoint, and shared DSHs (host keys,
  the access list, invites, the archive). It stays an extension of
  `server/edition`, which every binary's main imports (`server/relay`), so it
  reaches the server as before; its tables join the open schema.
- **The open web app is a client.** It holds the admin's shared-DSH page and a
  member's session page, with a non-extractable WebCrypto device key.
- **The phone app stays closed but reaches any server.** A release build asks
  for a server address as a development build does, and the open server
  accepts the app's sign-in redirect by default, so a self-hosted instance
  needs no setting for it.
- **The archive is open.** It is the admin's own record, encrypted to their
  key; the server only stores it. The positioning rule that the community
  edition does not grow governance stands for everything else.
- **What stays closed**: hosted billing (whose wallet holds already name a
  shared DSH's calls), the operator console, the app's source and store builds,
  and cloud computers, which are reached through the server and are not on the
  relay.

## Consequences

- A self-hosted team gets shared DSHs and phone access to its members' own
  computers, from the web or the official app, with the same end-to-end
  boundary as the hosted service.
- The hosted service's relay tables are replaced by the open ones. Pairings and
  shared hosts made before the move are not carried over: phones pair again and
  shared DSHs get new keys. The relay was not yet offered to anyone, so this is
  a Building-stage break.
- The relay's protocol, admission rules and encryption become part of the open
  surface, maintained once the community edition is released.
- The open server sends push messages to Expo when a paired phone asked for
  them; an instance whose phones never turn notifications on sends none.
- Ruled out: two relays, a closed shared DSH, a community edition reachable
  only from the web, and an app that signs in to the hosted service alone.
