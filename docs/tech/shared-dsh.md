# Shared DSH

> **Status:** Current · **Updated:** 2026-11-18

How a team shares one DSH that it runs itself: members reach it from the app
or the web through the relay, end to end encrypted, and the server can route
their traffic but never read it. It is part of the community edition
([ADR 0044](../adr/0044-the-relay-and-shared-dshs-are-open.md)), on a
self-hosted server as on the hosted one. This file is how it works, where
each part lives, the decisions it rests on, and how it is tested.

## The route in one paragraph

A team admin creates a **team host key** in the team's console and types it
into the teamwork plugin's shared mode on the DSH the team will share. That
DSH then belongs to one team and to no person: it cannot sign in as an
account, it syncs that team's configuration, and its team-model calls are
billed to the team, under the team's budgets and no member's. Members reach it
through the relay ([relay.md](relay.md)), which forwards end-to-end encrypted
records between paired devices. Two lists must both admit a member: the server's **access list** for that DSH, which decides who may
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

## What it does

- An admin turns a DSH into the team's shared DSH with one key, from
  `/teamwork share enable` or the Teamwork panel, and names on the web who may
  reach it.
- A listed member pairs a phone or a browser once, by invite, unlocks with
  their PIN, and lists, starts, follows and answers their own sessions on it.
- Removing a member, or revoking the host key, cuts access on the next request.
- The admin decrypts and reads every remotely driven session from the archive.
- The same PIN lock protects a member's phone reaching their own computer.

## What it does not do

- More than one team per DSH, or a shared DSH that is also someone's own.
- Several members driving one session together, or handing a session over.
- Sessions started at the DSH's own keyboard being reachable remotely.
- Recovering an archive whose private key was lost.
- Cloud computers, which the hosted edition reaches through the server, which
  reads them; a shared DSH is the team's own machine and is not.
- A budget per shared DSH: a team caps its shared DSH by capping the team. It
  would be a new budget scope if a team asks for one.
- Files, images, or choosing a folder, preset or model when starting a
  session, from the web client; the app has them.

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
   and the secret's hash. The app opens the link; in a browser it is pasted
   into the console's Shared DSHs page.
2. **The admin hands it over outside the server**: in person, or through a
   channel the team trusts. An invite carried by the server could be swapped
   for one naming a key the server holds.
3. **The member opens it signed in.** The device calls
   `POST /relay/shared/{hostId}/join`; the relay checks team, access list and
   device credential, and creates a pending pairing for that member and
   device. The device runs Noise XX through it, **pinning the DSH key from
   the invite**, so a relay that answers with another key fails the
   handshake.
4. **Inside the channel** the device sends `shareJoin`: the invite id, the
   secret and its display name; the PIN is asked once it is admitted. The DSH checks the invite is unspent, for
   that member (the pairing's member, as the relay states it, must match the
   invite's), and the secret against the hash it kept; it adds the device
   under the member, spends the invite and confirms the pairing with the
   relay, or answers `joinRefused`.
5. **Before step 4 the device shows the disclosure**: this DSH is the team's,
   others on its access list can reach the same machine, and the team's admin
   can read every session on it. The member confirms or stops.

Each further device of a member needs its own invite. Removing a device is
done on the DSH, or from the device itself (it revokes its pairing as today).

## Sessions belong to their starter

The bridge (`src/bridge.ts`) asks the owner filter (`src/shared-owner.ts`)
before it replays anything:

- `session/create` records `sessionId → memberId` in the roster file.
- `session/list` returns only the member's sessions, and no sub-agent
  entries; `$events` forwards only items whose session id (`sessionId`,
  `args[0]` or `agentId`) is the member's.
- `session/state`, `session/page`, `session/prompt`, `session/cancel`,
  `session/follow`, the upload calls, `teamwork/selectModel` and
  `userQuestions/answer` refuse another member's session as `not_found`,
  checked on the root session of the address.
- `$events/result` is accepted only for an `eventId` the bridge forwarded to
  that member. DSH itself would accept any identity's answer ("What the design
  rests on").
- A waiting signal (`waiting`) is still generic; a member's app learns over
  the channel which of their own sessions wait.
- Sessions without an owner (started at the DSH) are invisible remotely.

A personal computer's bridge is unchanged: its one member owns everything.

## The PIN

The plugin's `src/pin-lock.ts`; the clients' gates are the app's
`components/pin-gate.tsx` and the console's `PinGate`.

- **Four digits, one per member, set by the member** from their own device the
  first time a channel to this DSH is authorized, and changed from any of their
  devices with the old PIN (`setPin`). The DSH stores it as scrypt with its
  parameters and salt.
- **Sent only inside the channel**; nothing is derived from it. It is a second
  lock on a device that already proved its key.
- **Asked whenever a channel is authorized and after fifteen minutes with
  nothing sent on it**: the DSH says `pinRequired` (with `set` when the member
  has none yet), and until `unlock` or `setPin` succeeds it answers every call
  with `teamwork/locked` and ends every stream, so nothing reaches DSH. An
  unlock lasts as long as the channel and its idle timer.
- **Five wrong PINs lock that member** on every device until whoever runs the
  DSH clears it there (`/teamwork share unlock <email>`); a forgotten PIN is
  cleared the same way and set again at the next connection. The count is kept
  in the PIN file, so a restart does not reset it.
- **The personal relay has the same lock**: its one member is `owner`, the
  phone sets the PIN at its first connection after pairing, the desktop checks
  it, and `/teamwork pin reset` clears it. Signing out, and entering or leaving
  shared mode, clears every PIN.

## The audit archive

**The format is [ADR 0045](../adr/0045-the-shared-archive.md).**

- The admin runs `dsh-teamwork-audit keygen` on their own machine (a command
  the plugin's package installs). It writes the X25519 key pair to a file they
  keep (mode 0600) and prints the public key, which they give the DSH
  (`/teamwork share audit-key <public key>`). The DSH holds only the public
  key; **shared mode admits no member until it has one**.
- Every frame between a member's device and the DSH, both ways, becomes a
  record: member, device, direction, time and the frame. A string over 64 KiB
  (a file's bytes) is kept as its length and SHA-256. Records are batched into
  segments of at most 1 MiB or one minute. Each segment is HPKE-sealed
  (RFC 9180: DHKEM X25519, HKDF-SHA256, AES-256-GCM) to the audit public key,
  under a clear header the AEAD binds: host id, sequence number, the previous
  segment's SHA-256, and the audit key's fingerprint. The DSH signs the header
  and a digest of the ciphertext with its bound identity key.
- The plugin writes each segment to a queue on disk before uploading it, and
  uploads in order (`POST /relay/shared/archive`); a failed upload stays queued
  and is retried with the next segment, never dropped. Leaving shared mode
  flushes what has collected and forgets the key.
- **The server keeps segments until the team is deleted**, as rows of
  `shared_archive_segments`, the bytes exactly as uploaded. It accepts a
  segment only when the host token's host signed it and it is the next in the
  chain, so it can refuse a forgery or a gap without opening anything.
  Deleting a shared DSH keeps its archive.
- The admin sees each shared DSH's archive on the console's shared DSH page
  and downloads it (`GET /api/teams/{teamId}/shared-archive/{hostId}`, one
  segment per line), then runs
  `dsh-teamwork-audit read <file> --key <key file>`, which checks the chain and
  each segment's key, prints every record as one JSON line, and names any
  segment missing, altered or sealed to another key. **A lost private key
  cannot be recovered.** A new key pair seals new segments only; the header
  says which key each needs.

## Where each part lives

### The open server (`server/`)

| What | Where |
| --- | --- |
| The host token (`auth.HostBearer`, ADR 0042): configs and the gateway for a host caller, `requirePlugin` | `server/internal/auth/tokens.go`, `server/internal/httpapi/identity.go`, `server/internal/gateway/gateway.go` |
| `usage_requests.host_id`, held to team and provider budgets only; `hostId` on usage entries and `FundingAdmission`; "Shared DSH" in the usage list | `server/internal/usage`, `api/openapi.yaml`, `apps/web` |
| The relay: sockets, pairing, handset credential, forwarding, push; shared hosts, their key exchange, the access list, joining, the archive's storage | `server/relay` (`shared.go`, `access.go`, `archive.go`), its tables in `server/internal/db/schema/relay.go` |

Tables (the hosted edition dropped its own copies, ADR 0044):

- `relay_hosts`, `relay_pairing_offers`, `relay_pairings`: as the hosted relay
  had them. A host row gains a nullable `shared_host_id`, and its `user_id` is
  empty for a shared host; a pairing stays (member, host, handset).
- `shared_hosts`: `id`, `team_id`, `name`, `key_hash`, `identity_key`
  (nullable until bound), `created_by`, `bound_at`, `last_seen_at`,
  `created_at`, `access` (`team` | `listed`).
- `shared_host_members`: `host_id`, `user_id`, `added_by`, `created_at`;
  unique pair.
- `shared_archive_segments`: `id`, `host_id`, `team_id`, `seq`,
  `prev_digest`, `digest`, `data` (the segment's bytes), `created_at`; unique
  `(host_id, seq)`. No foreign key to `shared_hosts`: the archive outlives a
  deleted host.

Routes:

| Route | Caller | Does |
| --- | --- | --- |
| `GET/POST /api/teams/{teamId}/shared-hosts` | Team admin session | List; create (returns the key once) |
| `PATCH/DELETE /api/teams/{teamId}/shared-hosts/{id}` | Team admin | Rename, set access; revoke |
| `POST /api/teams/{teamId}/shared-hosts/{id}/rotate` | Team admin | New key, same binding |
| `PUT /api/teams/{teamId}/shared-hosts/{id}/members` | Team admin | The listed members |
| `GET /api/teams/{teamId}/shared-archive` | Team admin | Each shared DSH's archive, deleted hosts included |
| `GET /api/teams/{teamId}/shared-archive/{hostId}` | Team admin | One host's segments in order, one per line |
| `POST /relay/shared/challenge`, `POST /relay/shared/token` | Plugin with the key | Nonce; host token |
| `/relay/plugin` hello with a host token | Plugin | Shared host socket; access list pushed as `members` |
| `GET /relay/shared` | Member app, or the console by its session | Shared DSHs this member may reach |
| `POST /relay/shared/{hostId}/join` | Member, with handset credential | Pending pairing for the invite handshake |
| `POST /relay/shared/archive` | Host token | Append one segment, in sequence |

Relay admission for a shared host replaces "same account" with "in the team
and on the access list"; everything after admission is the existing opaque
routing. Every team route re-reads the caller's admin role.

### Plugin (`dsh-teamwork/dsh-teamwork`)

| Module | Owns |
| --- | --- |
| `src/shared-mode.ts` | The key file, the exchange, renewal, refusing sign-in, entering and leaving shared mode |
| `src/shared-roster.ts` | Invites (as hashes), each member's devices, session owners; atomic 0600 file |
| `src/shared-owner.ts` | The owner filter the bridge asks before every call and stream |
| `src/pin-lock.ts` | PIN hashes, failure counts and locks, per member (`owner` on a personal computer) |
| `src/phone-security.ts` | The invite handshake (`shareJoin`, `pairAccepted`, `joinRefused`) beside the safety-code one; the PIN gate (`pinRequired`, `unlock`, `setPin`) |
| `src/audit-archive.ts`, `src/audit-cli.ts` | Records, segments, HPKE sealing, the chain, the upload queue; `dsh-teamwork-audit keygen` and `read` |
| `src/relay.ts` | The host token on the socket, and the `members` list the relay sends |
| `src/index.ts`, `src/panel.ts`, `src/web/TeamworkPanel.tsx` | `/teamwork share enable|disable|status|invite|members|unlock|audit-key`, and the panel's Shared DSH page, which runs the same functions |

HPKE comes from `@hpke/core` at an exact version; no other new dependency.

### Clients

- **The open web app** (`apps/web`): the page
  `/teams/:teamId/shared-hosts`, where every member sees the shared DSHs they
  may reach and joins one by pasting its invite, and an admin also manages
  keys, access and the archive; and `/teams/:teamId/shared-hosts/:computerId`,
  the member's sessions on one, with the PIN, the conversation, answering and
  sending. Its device key is a non-extractable WebCrypto Ed25519 key in
  IndexedDB, per account (`apps/web/src/lib/relay.ts`). The page is on the
  server's own origin, so the relay admits it by its session cookie, never a
  token in the page: reads, writes from this site, and a socket only when its
  upgrade's `Origin` is `APP_URL`. A session whose account still has an
  admin-set first password is nobody to the relay, as to every extension.
  The relay client, the secure channel and the reader of DSH's wire are the
  open `packages/relay-client`, which the app imports too.
- **The phone app** (closed, under `premium/` where that directory exists):
  `dshteamwork://join` links and QR; the disclosure; the PIN; shared DSHs in
  the computer switcher under their team's name; and a server address in
  release builds, so it reaches a self-hosted server. The open server admits
  the app's sign-in redirect, `dshteamwork://sign-in`, with no setting
  ([ADR 0046](../adr/0046-every-server-sends-the-app-its-code.md)).
- Copy in every client's messages, both languages; `/docs` pages for shared
  mode, invites and the archive.

## What the design rests on

Measured before building (2026-11-17), with the code thrown away.

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
DSH key and answering with another fails with `UnexpectedPeerError`. So the
web client keeps its device key non-extractable.

**Archive sealing** (`@hpke/core` 1.7.5, Node 22): a 1 MiB segment seals in
3.3 ms and opens in 3.5 ms, with 32 bytes of encapsulated key and 16 of tag;
one flipped byte fails to open.

## Decisions taken

Decided by the developer on 2026-11-18:

- **The archive costs a team nothing on the hosted service, with no limit.**
  It is kept until the team is deleted, and the service carries its storage;
  a rule follows only if real use calls for one.
- **A deleted account's records stay in the team's archive**, sealed, until
  the team is deleted: they are the team's record, and the server could not
  separate one member's records from a segment anyway. The hosted privacy
  policy says so.
- **A team may have any number of shared DSHs.** Each runs on the team's own
  machine and is billed to the team; to the server it is one row and one relay
  socket.

## How it is tested

End-to-end against a real plugin, relay and server (`go test -tags e2e ./e2e`
in `server/`, driving the clients' `packages/relay-client`), the relay's own
suite on all three databases (`server/relay`), the plugin's suites, and the
app's:

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
