# Shared DSH

> **Status:** Plan — steps 0 to 2 done · **Updated:** 2026-11-17

How a team shares one DSH that it runs itself: members reach it from the app
or the web through the relay, end to end encrypted, and the server can route
their traffic but never read it. It is part of the community edition
([ADR 0044](../adr/0044-the-relay-and-shared-dshs-are-open.md)), on a
self-hosted server as on the hosted one. This file is the design, what each
part gains, and the order of work.

## The route in one paragraph

A team admin creates a **team host key** in the team's console and types it
into the teamwork plugin's shared mode on the DSH the team will share. That
DSH then belongs to one team and to no person: it cannot sign in as an
account, it syncs that team's configuration, and its team-model calls are
billed to the team, under the team's budgets and no member's. Members reach it
through the relay, which forwards end-to-end encrypted records between paired
devices. Two lists must both admit a member: the server's **access list** for that DSH, which decides who may
connect, and the DSH's own **roster** of member device keys, which decides who
may act. A device joins the roster once, through a single-use invite the admin
hands over outside the server. Every session belongs to the member who
started it; each member unlocks the DSH with a PIN of their own that only the
DSH checks. The DSH writes an **audit archive** sealed to a key only the admin
holds, and the server stores it without being able to open it.

## Trust model

End-to-end encryption here means: **the server routes and stores, and cannot
read or forge, what passes between a member's device and the DSH.** It rests on
one premise, accepted on 2026-11-17: the code a member runs was served
honestly. That covers the app from the stores and the web client the server
serves; a server that ships a malicious client is outside this boundary, as a
malicious DSH or plugin update is.

| The server can | The server cannot |
| --- | --- |
| See who connects to which DSH, when, and how much | Read a message, a tool call, a file or a PIN |
| Refuse, delay or drop traffic; refuse a member admission | Make the DSH accept a device the admin did not invite |
| Store the archive, count and drop records | Read the archive, or alter it without the admin noticing |
| Read model context sent through the gateway | Read context the DSH sends straight to a provider with its own key |

Decided with this premise:

- **No audit by the server.** Audit is the admin's, through the archive.
- **No isolation between members on one DSH.** The DSH is one
  operating-system user with whatever credentials the admin gave it; an agent
  started by one member can read another's files. Session ownership decides
  who may drive and answer a session; it is not a sandbox. Members accept this,
  as on the hosted edition's cloud computers.
- **Model routes are the team's choice.** A team model goes through the
  gateway, is metered and budgeted, and its context passes the server in
  plaintext. A model the DSH calls directly with a key it holds (BYOK on the
  DSH) does not, and is outside the server's metering and budgets
  ([usage-budgets.md](usage-budgets.md)). The app and the console label each
  model's route.

## Goal

- An admin turns a DSH into the team's shared DSH with one key, from the
  plugin's CLI or the desktop panel, and names on the web who may reach it.
- A listed member pairs a phone or a browser once, by invite, unlocks with
  their PIN, and lists, starts, follows and answers their own sessions on it.
- Removing a member, or revoking the host key, cuts access on the next request.
- The admin decrypts and reads every remotely driven session from the archive.
- The same PIN lock protects a member's phone reaching their own computer.

## Non-goals of this plan

- More than one team per DSH, or a shared DSH that is also someone's own.
- Several members driving one session together, or handing a session over.
- Sessions started at the DSH's own keyboard being reachable remotely.
- Recovering an archive whose private key was lost.
- Cloud computers, which the hosted edition reaches through the server, which
  reads them; a shared DSH is the team's own machine and is not.

## Identities and keys

| Who | Proves itself with | Kept | Opens |
| --- | --- | --- | --- |
| The DSH, to the server | Team host key, exchanged for a one-hour host token by a signature of its identity key | Plugin, `<cache>.shared.json`, mode 0600 | Its team's `GET /api/configs`, the gateway for its team's models, the relay's plugin socket, archive upload |
| The DSH, to members | Ed25519 identity key, the same one it signs the exchange with | Plugin, `<cache>.phone-keys.json` | Members pin it from the invite |
| A member's device, to the server | Account Bearer and relay handset credential | App SecureStore; browser IndexedDB | Relay admission, if on the access list and in the team |
| A member's device, to the DSH | Ed25519 identity key, enrolled by invite | App SecureStore; browser IndexedDB | Business calls, if on the roster |
| A member, to the DSH | Four-digit PIN, inside the channel | The member's memory; scrypt hash in the roster | Unlocks the channel |
| The admin, to the archive | X25519 audit key pair | Private key on the admin's own machine only; public key in the plugin | Decrypting the archive |

### The team host key

- **Created by a team admin on the web, shown once.** Format
  `dshh_<id>_<secret>`: the id names the row, the 32-byte secret is stored as
  an HMAC under `AUTH_SECRET` with its own purpose, as sign-in codes are. It
  names one team and belongs to the team, not the admin who made it.
- **Bound to one machine on first use.** The plugin asks for a nonce, signs
  `nonce ‖ key id ‖ server` with its identity key and sends the key, its
  public key and the signature. The first exchange records the public key;
  every later one must be signed by it, so a copied key fails on another
  machine. Rebinding a machine means revoking and creating a key.
- **Exchanged for a host token** (`auth.HostBearer`, [ADR 0042](../adr/0042-host-tokens.md)): one
  shared host, one team, no person, at most an hour, renewed by the plugin.
  Every route but configs and the gateway treats it as nobody, so a shared DSH
  can never act as a person.
- **Revocable and rotatable**, unlike a sealed token: the key is a row, every
  exchange and every relay connection re-reads it, and revoking closes the
  host socket. An already issued host token survives at most its hour on
  configs and the gateway; the relay refuses it at once.
- **The plugin refuses `/teamwork login` and drops any personal token while
  in shared mode**, and leaving shared mode deletes the key, the roster and
  the audit public key. The server-side refusal is what holds.

### Two lists

- **The access list** is the server's, per shared DSH: `team` (every member)
  or `listed` (named members), edited by team admins. The relay checks it and
  team membership at every phone connection and every join, and closes sockets
  when either changes.
- **The roster** is the DSH's: members, their device public keys, PIN hashes,
  failure counters and locks. The DSH refuses any business call from a device
  not on it. The relay sends the plugin the access list when it connects and
  whenever it changes; the plugin removes from the roster anyone no longer on
  it, and never adds anyone from it.

## Pairing by invite

The personal relay pairs two screens one person watches, with a safety code.
A shared DSH may be headless and its admin is not the member, so
it pairs by invite. The commitment and safety-code steps are replaced by the
invite's pinned key and secret; Noise XX, the AES-GCM records and the relay
frames stay as they are.

1. **The admin creates an invite on the DSH** (`/teamwork share invite
   <email>` or the panel), for a member on the access list. The invite is a
   link and QR:
   `dshteamwork://join?server=…&host=<hostId>&key=<DSH public key>&invite=<id>&secret=<128-bit>`,
   valid 24 hours, single use. The DSH keeps the invite id, the member's id
   and the secret's hash. On the web the same link opens the web client.
2. **The admin hands it over outside the server**: in person, or through a
   channel the team trusts. An invite carried by the server could be swapped
   for one naming a key the server holds.
3. **The member opens it signed in.** The device calls
   `POST /relay/shared/{hostId}/join`; the relay checks team, access list and
   device credential, and creates a pending pairing for that member and
   device. The device runs Noise XX through it, **pinning the DSH key from
   the invite**, so a relay that answers with another key fails the
   handshake.
4. **Inside the channel** the device sends `shared/join`: the invite id,
   `HMAC(secret, handshake hash)`, its display name and a new PIN, or nothing
   if the member already has one. The DSH checks the invite is unspent, for
   that member (the pairing's member, as the relay states it, must match the
   invite's), and the proof; it adds the device under the member, stores the
   PIN, spends the invite and confirms the pairing with the relay.
5. **Before step 4 the device shows the disclosure**: this DSH is the team's,
   others on its access list can reach the same machine, and the team's admin
   can read every session on it. The member confirms or stops.

Each further device of a member needs its own invite. Removing a device is
done on the DSH, or from the device itself (it revokes its pairing as today).

## Sessions belong to their starter

The bridge (`src/bridge.ts`) gains an owner check before it replays anything:

- `session/create` records `sessionId → memberId` in the roster file.
- `session/list` returns only the member's sessions, and no sub-agent
  entries; `$events` forwards only items whose session id (`sessionId`,
  `args[0]` or `agentId`) is the member's.
- `session/state`, `session/page`, `session/prompt`, `session/cancel`,
  `session/follow`, the upload calls, `teamwork/selectModel` and
  `userQuestions/answer` refuse another member's session as `not_found`,
  checked on the root session of the address.
- `$events/result` is accepted only for an `eventId` the bridge forwarded to
  that member. DSH itself would accept any identity's answer (step 0).
- A waiting signal (`waiting`) is still generic; a member's app learns over
  the channel which of their own sessions wait.
- Sessions without an owner (started at the DSH) are invisible remotely.

A personal computer's bridge is unchanged: its one member owns everything.

## The PIN

- **Four digits, one per member, set by the member** on their first device
  during the join, and changed from any of their devices with the old PIN
  (`shared/pin`). The DSH stores it as scrypt with its parameters.
- **Sent only inside the channel**; nothing is derived from it. It is a second
  lock on a device that already proved its key.
- **Asked when the app or page opens the DSH and after fifteen minutes idle**
  (`shared/unlock`). Until then the DSH answers only `shared/unlock`; the
  unlock lasts as long as the channel and its idle timer.
- **Five wrong PINs lock that member** on every device until the admin clears
  the lock at the DSH (`/teamwork share unlock <email>`); a forgotten PIN is
  cleared the same way and set again at the next connection. The counter is
  kept in the roster file, so a restart does not reset it.
- **The personal relay gains the same lock**: the phone sets a PIN when it
  pairs, the member's own desktop stores and checks it, and the desktop clears
  a lock. Existing pairings are asked for a PIN at their next connection.

## The audit archive

**Format** (an ADR when step 5 lands):

- The admin runs `dsh-teamwork audit keygen` on their own machine. It writes
  the X25519 private key to a file they keep and prints the public key, which
  they give the DSH (`/teamwork share audit-key <public key>`). The DSH holds
  only the public key; shared mode does not admit members until it has one.
- Every event the bridge passes for a member (a call and its result, each
  mux item, with member id, device id and time) becomes a record. Records are
  batched into segments of at most 1 MiB or one minute. Each segment is
  HPKE-sealed (RFC 9180: DHKEM X25519, HKDF-SHA256, AES-256-GCM) to the audit
  public key, then carries a header in the clear: host id, segment sequence
  number, the previous segment's SHA-256, the audit key's fingerprint, and an
  Ed25519 signature by the DSH over all of it.
- The plugin queues segments on disk and uploads them in order
  (`POST /relay/shared/archive`); a failed upload is retried and never
  dropped.
- **The server keeps segments until the team is deleted**, under the team, in
  its byte store (local directory or S3,
  [ADR 0033](../adr/0033-private-artifact-storage-providers.md)), with a row per
  segment.
- The admin downloads them (`GET /api/teams/{teamId}/shared-hosts/{id}/archive`)
  and runs `dsh-teamwork audit read <dir> --key <file>`, which verifies
  signatures and the chain, reports gaps and alterations, and prints or exports
  the sessions. **A lost private key cannot be recovered.** A new key pair
  seals new segments only; the header says which key each needs.

## What each part gains

### The open server (`server/`)

| Change | Where |
| --- | --- |
| Done (step 1): `auth.HostBearer`, `requirePlugin`, configs and the gateway for a host caller | `server/internal/auth/tokens.go`, `server/internal/httpapi/identity.go`, `server/internal/gateway/gateway.go` |
| Done (step 1): `usage_requests.host_id`, held to team and provider budgets only; `hostId` on usage entries and `FundingAdmission`; "Shared DSH" in the usage list | `server/internal/usage`, a migration per dialect, `api/openapi.yaml`, `apps/web` |
| Step 3: the relay, moved from the hosted edition: sockets, pairing, handset credential, forwarding, push; shared hosts and their key exchange | `server/internal/relay`, its tables in the open schema, routes in `api/openapi.yaml` |
| Steps 4 to 6: access list, invites, archive storage | the same package |

A budget per shared DSH is not built: a team caps its shared DSH by capping
the team. It would be a new budget scope if a team asks for one.

Tables, once moved (one migration per dialect; the hosted edition drops its
own copies, ADR 0044):

- `relay_hosts`, `relay_pairing_offers`, `relay_pairings`: as the hosted relay
  had them. A host row gains a nullable `shared_host_id`, and its `user_id` is
  empty for a shared host; a pairing stays (member, host, handset).
- `shared_hosts`: `id`, `team_id`, `name`, `key_hash`, `identity_key`
  (nullable until bound), `created_by`, `bound_at`, `last_seen_at`,
  `created_at`; step 4 adds `access` (`team` | `listed`) and step 6
  `audit_key_fingerprint`.
- `shared_host_members` (step 4): `host_id`, `user_id`, `added_by`,
  `created_at`; unique pair.
- `shared_archive_segments` (step 6): `id`, `host_id`, `team_id`, `seq`,
  `prev_digest`, `digest`, `size`, `object_key`, `created_at`; unique
  `(host_id, seq)`.

Routes:

| Route | Caller | Does |
| --- | --- | --- |
| `GET/POST /api/teams/{teamId}/shared-hosts` | Team admin session | List; create (returns the key once) |
| `PATCH/DELETE /api/teams/{teamId}/shared-hosts/{id}` | Team admin | Rename, set access; revoke |
| `POST /api/teams/{teamId}/shared-hosts/{id}/rotate` | Team admin | New key, same binding |
| `PUT /api/teams/{teamId}/shared-hosts/{id}/members` | Team admin | The listed members |
| `GET /api/teams/{teamId}/shared-hosts/{id}/archive[/{seq}]` | Team admin | Segment list; one segment's bytes |
| `POST /relay/shared/challenge`, `POST /relay/shared/token` | Plugin with the key | Nonce; host token |
| `/relay/plugin` hello with a host token | Plugin | Shared host socket; access list pushed as `members` |
| `GET /relay/shared` | Member app or browser | Shared DSHs this member may reach |
| `POST /relay/shared/{hostId}/join` | Member, with handset credential | Pending pairing for the invite handshake |
| `POST /relay/shared/archive` | Host token | Append one segment, in sequence |

Relay admission for a shared host replaces "same account" with "in the team
and on the access list"; everything after admission is the existing opaque
routing. Every team route re-reads the caller's admin role.

### Plugin (`dsh-teamwork/dsh-teamwork`)

| Module | Owns |
| --- | --- |
| Done (step 2): `src/shared-mode.ts` | The key file, the exchange, renewal, refusing sign-in, entering and leaving shared mode |
| `src/shared-roster.ts` (new) | Members, devices, invites, PIN hashes, counters and locks, session owners; atomic 0600 file |
| `src/audit-archive.ts` (new) | Records, segments, HPKE sealing, the chain, the upload queue; `audit keygen` and `audit read` in `src/cli.ts` |
| `src/phone-security.ts` | The invite handshake beside the safety-code one; the PIN gate for personal pairings |
| `src/bridge.ts` | `shared/join`, `shared/unlock`, `shared/pin`; the owner check; feeding the archive |
| `src/relay.ts` | The host token on the socket |
| `src/panel.ts`, `src/cli.ts` | `/teamwork share invite|members|unlock|audit-key`, and shared mode in the desktop panel |

HPKE comes from `@hpke/core` at an exact version; no other new dependency.

### Clients

- **The open web app** (`apps/web`): the admin's page
  `/teams/:teamId/shared-hosts` for keys, access and archive download (moved
  from the hosted edition's web app in step 3), and a member's page
  `/teams/:teamId/shared/:hostId` with the sessions screen, its device key a
  non-extractable WebCrypto Ed25519 key in IndexedDB (step 0). The relay
  client, the secure channel and the reader of DSH's wire, which the closed
  app holds today, become an open package both import.
- **The phone app** (closed, under `premium/` where that directory exists):
  `dshteamwork://join` links and QR; the disclosure; the PIN; shared DSHs in
  the computer switcher under their team's name; and a server address in
  release builds, so it reaches a self-hosted server. The open server admits
  the app's sign-in redirect, `dshteamwork://sign-in`, by default.
- Copy in every client's messages, both languages; `/docs` pages for shared
  mode, invites and the archive.

## Order of work, and what gates what

Each step is a vertical slice, lands green, and brings its ADR.

0. **Spikes, thrown away — done 2026-11-17**, results below. None changes the
   design; the first sharpens the owner check.
1. **Host token in the open server — done 2026-11-17**
   ([ADR 0042](../adr/0042-host-tokens.md)). Token kind, configs, the gateway
   and `usage_requests.host_id`, with a test on all three databases.
2. **Shared mode end to end, no members yet — done 2026-11-17**, in the
   hosted edition first: shared hosts, the key exchange and binding, the
   plugin's `src/shared-mode.ts` and `/teamwork share`, and the admin's page.
   A key binds the first machine that signs with it, and syncs one team.
3. **The relay moves into the open server** (about 4 days;
   [ADR 0044](../adr/0044-the-relay-and-shared-dshs-are-open.md)). The relay
   package, its tables and the shared-host routes join `server/`; the
   edition's `MintHostToken` gives way to a direct call; the admin's page joins
   `apps/web`; the relay's end-to-end test runs in `server/e2e`; the hosted
   edition drops its relay and its tables. Done when the community server's
   gate runs the relay suite and the plugin's end-to-end tests for pairing and
   shared mode.
4. **Members reach it** (about 8 days; an ADR "A shared DSH admits a device by
   invite"). Access list, `/relay/shared` and join, invite handshake, roster,
   owner check, the app's join flow and disclosure. Done when a member's phone
   drives its own sessions and nobody else's, on a community server.
5. **The PIN lock** (about 4 days), on the shared DSH and the personal relay
   together, in the plugin and the app.
6. **The audit archive** (about 6 days; an ADR on its format). Key commands,
   sealing, upload, storage, admin download, `audit read`. The hosted privacy
   policy states the archive before this ships there.
7. **The web client** (about 8 days). The open package, then the page.
8. **The app reaches any server** (about 2 days): a server address in release
   builds and the default redirect.

### Step 0 results (2026-11-17)

**Owner filtering, on DSH 0.2.2-rc.3** (`dsh web`, a scripted local model,
two `/connect?interactions=answer` identities on one DSH, each with its own
mux, as two pairings have):

- **DSH attributes nothing to an identity, so the bridge must.** Both
  identities' `$events` received every session's `api-session/*` events and
  every `user-questions/request`, including questions still pending from
  before they connected. Identity B answered a question in a session A
  created, and DSH accepted it (`$events/result` returned `ok`). `session/list`
  returns every session to everyone.
- **Every event names its session.** `api-session/added` carries the summary
  with `sessionId`; `status` and `activity` carry it as `args[0]`; a question
  carries it as `agentId`. So the bridge filters `$events` items by the owner
  of that id, and checks `$events/result` against an `eventId → agentId` map
  it fills from the events it forwarded.
- **Sub-agents stay under their parent.** A sub-agent started by the
  `subagent` tool appears in `session/list` as its own entry (an id without
  the `session-` prefix, with a non-null `subagent` projection), but its
  question reached `$events` with the **parent's** `agentId`, and following
  the child directly is refused by DSH (`session/agent-busy`: "subagent
  Sessions require their durable parent address"). So the bridge hides entries
  whose `subagent` is set, and checks ownership on the root session of every
  address.
- **Sessions DSH creates by itself have no owner**: the agent's
  `schedule_create` tool can start one later. They are invisible remotely, as
  sessions started at the keyboard are. Inheriting the scheduling session's
  owner is a later change.
- Two identities ran concurrently without interfering; the existing
  per-pairing mux is enough.

**Browser keys** (libp2p Noise 16.1.5, Chromium 153): an Ed25519 key made by
WebCrypto with `extractable: false`, stored in IndexedDB, survives a reload
and signs. Noise only calls `privateKey.sign()` and reads `publicKey`, so a
ten-line wrapper over the WebCrypto key completes an XX handshake with the
DSH's existing pure-JS key, each side seeing the other's peer id. Pinning the
DSH key and answering with another fails with `UnexpectedPeerError`. **The
web client keeps its device key non-extractable**; the open choice in the web
client section is settled.

**Archive sealing** (`@hpke/core` 1.7.5, Node 22): a 1 MiB segment seals in
3.3 ms and opens in 3.5 ms, with 32 bytes of encapsulated key and 16 of tag;
one flipped byte fails to open.

Steps 2 to 5 are the smallest useful version: a team's shared DSH reached
from phones, on a community server. Step 6 is required before it is offered to
a team; steps 7 and 8 after. About eight weeks for one developer, spikes
included.

## Open questions

1. **What the archive costs** the hosted service, and whether it counts
   against a team's storage there, since it is kept forever.
2. **What a deleted account's records in a team's archive become.** They are
   the team's record; the privacy policy says so before step 5 ships.
3. **How many shared DSHs a team may have**, and whether that is a plan limit.

## How done is verified

End-to-end tests against a real plugin, relay and server
(`go test -tags e2e ./e2e` in `server/`), plus the app's integration suite:

- a host key copied to a second machine is refused; a revoked or rotated key
  is refused on the next exchange and its socket closes;
- a host token opens no route but configs, the gateway, the relay socket and
  archive upload; the plugin refuses sign-in in shared mode; usage lands on the
  team with the host named, and a team budget stops its calls;
- a member off the access list, or out of the team, is refused by the relay;
  a device off the roster is refused by the DSH even when the relay admits it;
- a relay that substitutes its own key during an invite handshake fails it;
  an invite is spent once, expires, and works only for its member;
- a member cannot list, follow, prompt, cancel or answer another member's
  session;
- the sixth wrong PIN is refused even with the right one, across restarts,
  until the admin clears it; the personal relay asks for its PIN;
- the archive decrypts with the admin's key and its sessions match what the
  member saw; a dropped, reordered or altered segment is reported.
