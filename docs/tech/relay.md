# Relay and pairing

> **Status:** Current · **Updated:** 2026-11-19

How a phone or a browser reaches a DSH through the server, end to end
encrypted ([ADR 0044](../adr/0044-the-relay-and-shared-dshs-are-open.md); the
hosted edition's ADRs 0008 and 0009 first shaped it): the relay, how the plugin and the app each authenticate,
the pairing table, the frames the relay moves, the allow-list in the plugin,
encrypted transport, push notifications and release constraints.

## The route in one paragraph

The relay (`server/relay`), mounted by every binary, holds two kinds of WebSocket:

- one from each running DSH, opened by the teamwork plugin with the Bearer
  token it already has;
- one from each phone, opened by the app with a token of its own.

A phone is joined to a DSH only through a **pairing**: a row the member
created by scanning a code that DSH showed, revocable from either side and
re-read on every connection. Both devices also pin each other's locally
generated identity keys after explicit verification (the hosted edition's ADR 0018). The relay
forwards opaque encrypted records; the plugin decrypts and checks each method
against its allow-list (the hosted edition's ADR 0009) and replays it against DSH's own
Remote API on loopback, as the answering identity it obtained in-process. The
replies travel back the same way. The relay authenticates both ends, checks
pairings, counts and drops frames, and never parses DSH's wire.

## Goal

The hosted edition's smallest useful version works end to end:

- a member pairs a phone with their computer;
- from the phone they list that computer's sessions, start or open one, send a
  message, follow the output live, and answer the agent's questions and
  approvals;
- the phone is notified when something waits for them;
- revoking the pairing cuts the phone off at once.

## Non-goals of this plan

- **Driving another member's DSH.** A pairing joins one person's phone to one
  of their own computers. A DSH a team shares is planned in
  [shared-dsh.md](shared-dsh.md), with a PIN lock this relay gains too.
- **Hiding model inputs from the model gateway.** End-to-end encryption covers
  the phone-to-computer channel. Team-model context still passes through the
  hosted gateway; local and enterprise-direct models have their own routes.
- **Storing session content on the service.** The relay keeps only
  connection and pairing metadata. The one exception is a page an agent
  publishes with the plugin's `teamwork_page` tool, which the plugin uploads
  to the server itself, outside the relay ([pages.md](pages.md),
  [ADR 0052](../adr/0052-pages-are-uploaded-when-made.md)).
- **More than one relay instance.** Routing a phone to the instance that holds
  its DSH's socket is deferred until one instance is not enough. A single
  instance on Railway is the starting point.
- **The cloud agents and the Lark bot.** They reuse this channel later; the
  channel is not shaped for them now.

## What is added, and where it lives

| Piece | Where | Edition |
| --- | --- | --- |
| The relay: WebSocket endpoints for plugins and phones, pairing checks, envelopes, push, and `GET /api/relay` | `server/relay`, an extension every binary's main imports, served under `/relay` on the server's own port | Open |
| Pairing and device tables | `server/internal/db/schema/relay.go`, migrated with the rest of the open schema | Open |
| The plugin's outbound connection, pairing panel and allow-list | `dsh-teamwork/dsh-teamwork` (`src/relay.ts`, the Teamwork panel) | Open |
| The client: the encrypted channel, the frames, the live client, a computer's sessions over any link to its DSH (`src/dsh-sessions.ts`: the relay's channel is one, a server that reaches a computer itself another) and DSH's Remote API read into a client's shapes | `packages/relay-client`, imported by the web console and the app; its tests run on Node, and `server/e2e` drives it against the real plugin | Open |
| The app | `premium/apps/mobile` where that directory exists, from seed's Expo app | Closed; it reaches any server |

The relay mounts through `server/edition` like a closed extension, so it reads
the server's own database and opens tokens with the same `AUTH_SECRET`,
needing no call elsewhere on a connection.

## Identities and tokens

- **A shared DSH** ([shared-dsh.md](shared-dsh.md)) connects with its host
  token instead. Its relay host id is its shared host's id, so no host row is
  recorded; it is sent `{ t: 'members', members }`, everyone who may reach
  it, at its hello and at every ping, may not ask for a pairing code (its
  members join by invite, `POST /relay/shared/{hostId}/join`), and a phone
  reaches it only while its account is in the host's team and on its list.

- **The plugin** connects with the 30-day Bearer it already holds ([ADR 0001](../adr/0001-plugin-sign-in.md)).
  On first connection the relay records a **host**: the member's id, a stable
  `hostId` the plugin generates and keeps beside its cache, the machine's
  name, and the DSH version and operating system it reports, both refreshed on
  every connection. Its hello is `{ t: 'hello', token, clientId, name,
  dshVersion, os }`; `os` is `macos`, `windows` or `linux`, any other value is
  refused 4400, and a plugin that leaves it out (an older one, or a system the
  relay names none for) is recorded with none. The phone's list of pairings
  carries it as `hostOs` and the console's computers as `os`, for each to show
  beside the computer's name. A shared DSH reports none. The phone's list also
  carries `hostLastSeenAt`, the host's `last_seen_at` (a shared host's, which
  may be null), so it can say how long an offline computer has been away.
- **The app** signs in through the website the way the plugin does ([ADR 0001](../adr/0001-plugin-sign-in.md)):
  PKCE and a code. It receives its own Bearer, with `via` naming the app. The
  token says who the person is. On its own it reaches no computer.
- **The web console** is a client too, from the server's own origin: no
  token, its session cookie instead. The relay's HTTP routes take the cookie
  when no Bearer is sent (a write only from this site), and `/relay/phone`
  takes a hello without a token only when the upgrade's `Origin` is
  `APP_URL`, re-opening the cookie at every ping as it re-opens a token.
- **A pairing** is what lets an app token reach a host. Every phone frame
  names a `pairingId`. The relay accepts the frame only if three things hold:
  the pairing belongs to the token's subject, it is not revoked, and its host
  is connected.
- **Team membership** is re-checked when either end connects, as every team
  rule is (`edition.Host`'s `Users.InTeam`, in `server/relay/relay.go`): the person must be in at least one
  team (a person may be in several, [ADR 0013](../adr/0013-one-person-many-teams.md)). Someone removed from their
  last team loses the mobile entry at their next connection. Revoking their pairings
  closes any socket still open.

## Pairing

1. The desktop creates a locally gated, two-minute pairing ceremony and asks
   the relay for a single-use six-letter code. Its QR link also pins the
   desktop identity public key. The phone can scan or type the letters.
2. The same-account phone redeems the offer with its own relay admission
   credential. The relay binds the pending row to that account and credential
   and permits opaque handshake records; pending never authorizes business calls.
3. Both devices exchange commitments to their identity keys and fresh 32-byte
   random salts, then reveal and verify them. They authenticate those identities
   with libp2p Noise XX, binding the complete transcript to the pairing and channel.
4. Both screens display the same eight-digit safety code. The member compares
   it, confirms on the phone, then approves on the desktop. The desktop saves
   local trust before confirming with the relay; the phone saves trust only
   after the encrypted desktop acknowledgement. Neither trusts server confirmation
   alone. No business request is admitted until this ceremony completes.
5. Future channels pin both saved keys and use a fresh Noise handshake without
   another safety-code ceremony. Changed or missing keys require pairing again;
   old plaintext pairings cannot silently become trusted encrypted devices.
6. Desktop revocation closes the channel and persists local trust removal before
   asking the relay. Phone revocation first asks a connected desktop for an
   encrypted acknowledgement that trust was removed. When the relay answers that
   the desktop is offline (or no longer paired), the phone forgets the desktop
   and revokes through the relay alone, so a computer that never returns can
   still be removed; the desktop drops that phone's trust the next time it
   lists its pairings, since a revoked pairing is absent from the list. The
   relay's own revocation immediately cuts routing either way.

Pair redemption is limited to ten requests per member per ten-minute window.
The hosted edition's ADR 0020 binds relay admission to
the handset as well as its account. MobileKeys stores a separate 32-byte random
relay credential per server/account, generated with getRandomValues and reused
across sign-out and token renewal. Corruption or unavailable secure randomness
fails closed. The relay sees this credential but stores only its purpose-separated
HMAC under AUTH_SECRET as device_key_hash. It is not an E2EE private key.
List, revoke and socket attachment require both account and credential matches;
check before takeover so another handset cannot enumerate, revoke or detach the
original phone. A reconnect from the same handset may replace its own socket.
Multiple phones may independently pair with the same computer. Both pending and
confirmed rows admit the bound phone's opaque records, so safety-code verification
can complete before approval. Desktop local key verification still admits business
traffic. A malicious relay can deny service but cannot use this credential to
impersonate a pinned E2EE identity. No identity private key or transport key is uploaded. Mobile stores account/server-scoped secrets in
SecureStore, with a separate small entry per peer. The development-only web
build uses localStorage and does not have the native app's key-storage boundary.
The plugin atomically writes its seed and account/server-scoped trust roster to
`<cache>.phone-keys.json` with file mode 0600 and directory mode 0700.

The tables:

- `relay_hosts`: `id`, `user_id`, `client_id`, `name`, `dsh_version`, `os`,
  `last_seen_at`, `created_at`.
- `relay_pairing_offers`: `code_hash`, `host_id`, `expires_at`,
  `used_at`. Each code is stored as an HMAC, as the sign-in codes are.
- `relay_pairings`: `id`, `user_id`, `host_id`, `device_name`,
  `device_key_hash`, `push_token`, `push_locale`, `confirmed_at`, `revoked_at`,
  `last_used_at`, `created_at`.
- `shared_hosts`: a team's shared DSHs ([shared-dsh.md](shared-dsh.md)).

Each refers to an account or a team by its id alone, with no foreign key.
Deleting an account ([ADR 0039](../adr/0039-deleting-an-account.md)) removes its hosts,
their codes and every pairing of the account or its hosts, in the deletion's
transaction through `Host.SubscribeTeams`; a socket still open closes at its
next ping.

## Frames

One JSON frame per WebSocket message. The relay reads only the envelope. The
complete DSH business frame is inside authenticated ciphertext. The relay
rejects plaintext `call`, `result` and `mux` frames.
`server/relay/protocol.go` is the source; the plugin's `src/relay.ts`
and `src/bridge.ts`, and the clients' `packages/relay-client` (`src/protocol.ts`), restate it.

A phone connects to `/relay/phone` and proves who it is in its first frame,
`{ t: 'hello', token, deviceKey }`, as the plugin does on `/relay/plugin`. Each finds
the relay from `GET /api/relay`, which names `wss://<the site>/relay/plugin`;
the phone's HTTP calls are `POST /relay/pair`, `GET /relay/pairings`,
`DELETE /relay/pairings/{id}` and `PUT /relay/pairings/{id}/push`, all with
the X-Device-Key header.
Missing or malformed credentials fail with HTTP 400 or WebSocket 4400; an
unbound or another handset's pairing returns 404/not_paired. The relay re-checks
team membership then, and closes with 4401 for anyone else.

| Direction | `t` | Fields | Meaning |
| --- | --- | --- | --- |
| phone ↔ relay ↔ plugin | `sealed` | `pairingId`, `channelId`, `kind`, `data` | Commitment, reveal, Noise key bootstrap or AES-GCM records; `kind` is `commit`, `reveal`, `noise` or `data` |
| relay → phone | `error` | `pairingId`, `error` | Routing refusal: `not_paired`, `offline` or `rate_limited` |
| relay → phone | `offline`, `detached` | `pairingId` | Host unavailable or another socket took over |
| relay → plugin | `detach` | `pairingId` | Phone unavailable; close its transport and native streams |
| relay → either | `revoked` | `pairingId` | Drop the pairing |
| plugin → relay | `waiting` | none | Generic attention signal; no conversation identifier or question type |

Relay admission permits pending and confirmed, same-account, same-handset, unrevoked pairings
so the initial handshake can run. Local desktop trust controls execution.
The relay still sees account/device metadata, public keys during verification,
timing and sizes, and can drop or delay traffic. It cannot authenticate as a
pinned device or read/alter accepted business content. Endpoint compromise and
malicious client updates are outside this transport boundary.

`src/secure-channel.ts` in the plugin owns the transport; the mobile app keeps
an identical wire copy, checked by integration tests. Following
the hosted edition's ADR 0019, the established
`@chainsafe/libp2p-noise` XX encrypter authenticates devices and protects a fresh
random 32-byte AES sending key from each endpoint. It uses the existing JS
handshake backend, with the fixed `dsh-e2ee-aesgcm` domain and the complete
pairing/channel transcript in the prologue. Noise carries no business data.

The mobile custom entry installs missing DOM event constructors before Expo
Router evaluates routes and imports libp2p. Hermes does not expose Event,
EventTarget and CustomEvent globally. The pinned event-target-shim supplies a
coherent Event/EventTarget pair; the app adds the CustomEvent constructor/detail
extension. React Native's abort-controller 3 also lacks reason and
throwIfAborted, which Noise's stream dependencies require. The entry adds those
members to its existing prototypes, preserving fetch's controller/signal types.
Profile lookup uses an explicit controller and cleared timeout instead of the
unsupported AbortSignal.timeout. The PKCE verifier uses Expo getRandomValues,
which fails closed instead of getRandomBytes' development Math.random fallback.
A complete browser runtime remains unchanged. Startup tests cold-load the real
crypto graph through the configured entry with event globals missing. Another
smoke test bundles the browser dependency exports and completes a handshake plus
bidirectional fragmented messages using React Native's actual Abort provider and
Expo's UTF-8 decoder, without global WebCrypto or Buffer. Its injected AES adapter
does not replace validation on an Android/iOS device.

After importing both directional keys, all application traffic goes directly
through AES-256-GCM: Expo Crypto (CryptoKit / Android Cipher) on mobile and Node
crypto/OpenSSL on desktop. There is no JS cipher fallback. Expo's development
web backend uses WebCrypto. The asynchronous cipher pumps preserve send and
receive ordering and discard late results after closure. Native cryptography
does not by itself promise hardware acceleration or measured phone throughput.

Each decoded `data` record contains a four-byte big-endian counter, ciphertext
and 16-byte GCM tag, at most 384 KiB total before base64. Its 12-byte nonce is
eight zero bytes plus that counter. AAD is the SHA-256 prologue hash followed by
the sender role byte (initiator 1, responder 0), binding records to this channel
and direction. Counters start at zero under independent fresh directional keys;
any replay, gap, reordering or authentication failure closes the channel before
plaintext delivery. Close before counter 0xffffffff or more than 64 GiB of
plaintext per key; reconnect with fresh keys instead of resetting a counter.

Encrypted application messages keep their four-byte length prefix, 1 MiB limit
and bounded 2 MiB queues. A message over the limit would close the channel, so
the plugin's bridge makes everything it sends back fit (`fitFrame` in
`src/bridge.ts`): a frame within the limit passes as it is; a larger one has
its long strings (a tool's output, a file written) cut to 64, 16, 4 and then
1 KiB, and a follow's snapshot or a `session/page` result then keeps its newest
records and says `hasMore`. A stream frame that still cannot fit ends that
stream with `too_large`, and a call's result answers 502 `too_large`, without
touching the channel. The clients read the history before a snapshot with
`session/page` (`beforeSeq`, 50 messages, as DSH's own opening window), from
the member's "Show earlier messages".

A client keeps its follows when its socket, the channel or the computer goes
away for now (`packages/relay-client`, `dsh-sessions.ts`): each says it is closed,
tries again after 1, 2, 4, 8 and 15 seconds and then every 30, and opens with
a fresh snapshot, which clears what it said. DSH's `session/follow` takes no
cursor, so a follow never resumes part-way; the bounded snapshot is what makes
that cheap. A revoked pairing, another socket taking the handset's place, a
session DSH no longer has, or signing out ends a follow for good. AES records arriving before local key import completes
wait in a bounded queue. The handshake/bootstrap deadline is 20 seconds; human
verification has two minutes. Missing native crypto, authentication failure or
transport loss closes the channel, without downgrading. AES keys are memory-only;
closure drops references and clears temporary bootstrap buffers. Neither JS nor
the native backend promises complete deterministic memory zeroization.

Inside the encrypted channel, `call`, `result` and `mux` retain their native
shapes. Business methods, request/result bodies, session ids, paths, tool
results, file names and upload chunks are all encrypted. TLS and existing
sign-in, membership checks, upload budgets and native prompt deduplication hold.

The relay enforces two limits. A frame over 1 MiB closes the socket that sent
it. A phone may send 300 frames per pairing in ten seconds; past that its
frames are dropped and it is told `rate_limited`. Only the phone's side is
counted, since what comes back is the member's own computer answering. Both
numbers are a first guess, measured before a store release (step 7).

## The allow-list

It lives in the plugin's `src/bridge.ts`, the only party holding the full
identity (ADRs 0009 and 0015). Each pairing gets an answering identity of its own at DSH
(`/connect` with DSH's launch token and `interactions=answer`), minted on first
use, so DSH sees each phone as a separate client.

- **`call`:** the method must be on the list, or the plugin answers `403`
  without touching DSH. Where DSH serves no web (the terminal alone), every
  call is answered `503`.
- **`mux` `open`:** the stream's endpoint must be on the list, or the plugin
  answers with a stream `error` frame. `item`, `end` and `cancel` frames are
  accepted only for a stream this pairing opened and DSH has not ended.
- **The list:**
  - calls: `session/list`, `session/create`, `session/prompt`,
    `session/state`, `session/page`, `session/cancel`, `session/modelCatalog`,
    `teamwork/configuration`, `teamwork/selectModel`,
    `userQuestions/answer`, `$events/result`;
  - streams: `session/follow`, `$events`.
- **Tests:** `tests/bridge.test.ts` in the plugin holds the list, and drives
  the bridge with a method off it, a stream off it, and frames for a stream
  the pairing did not open, expecting each refused.

`teamwork/configuration` takes `{ args: { request: { sessionId? } } }` and returns
the native preset roster enriched with team id/name/version, tool and plugin
dependency states, plus the loaded session's actual directory, preset and model,
the folders a session may start in (`directories`), and each synced team's
default workspace (`teamDirectories`, team id to one of `directories`). The
member sets that default in the plugin's panel, under My teams
(`src/team-workspaces.ts`); until then it is the folder DSH was started in. A
client starting a session for a team and naming no folder starts it there
(`defaultDirectory` in `packages/relay-client`).
`teamwork/selectModel` takes `{ args: { request: { sessionId, provider, model,
reasoningEffort? } } }` and returns `{ selected }`. The session must pass native
admission and be idle; the desktop default is never saved. Native
`session/selectModel` is refused because it saves that default. Before forwarding
`session/prompt`, the plugin uses the same readiness checks as its local actions.
A refusal is a native-shaped `result: { ok: false, error: { code } }`, with a
bounded `teamwork/` code that the app localizes (the hosted edition's ADR 0015).

## File attachments

The attachment button beside Preset and Model opens the system document picker.
Text, code, logs, CSV, JSON and PDF are ordinary file attachments; PDF reading
still depends on the desktop tools. Files appear as removable cards above the
composer. Selection prepares private local cache copies and immediately streams
files to the paired computer. Text remains editable during transfer; Send waits
for every file to finish, applies the selected model, then submits one native
prompt containing text and/or completed receipts. Send never transfers bytes. File-only messages are supported, including in history
when the desktop originated them. A failed file never silently drops out of
an otherwise submitted message.

The rules of the transfer (limits, acknowledged chunks, the receipts and the
one request id an ambiguous acknowledgement keeps) are the relay client's
`attachments.ts`, which the app and the web console share. **The web console
transfers at Send instead** (`useFiles` in `dsh-session.tsx`): its picker is the
browser's, its bytes are the page's own `File`s, and a new session's first
message makes the session, uploads into it and then prompts, keeping that
session for a retry; changing its folder or preset before Send leaves it
behind. On a fast desktop link the overlap the app needs is not worth a
provisional session per draft.

A new-session draft creates a provisional native session on first selection.
Changing its workspace or preset releases the old plugin receipts, creates a
new target and uploads the retained files again. Changing only the model keeps
the target and receipts. Existing sessions always upload to their own id.
Creating a target and uploading files never submits a prompt or calls a model
(the hosted edition's ADR 0017); unused targets and stored objects follow native DSH retention.

DSH 0.2.2-rc.1 owns storage through authenticated
`POST /api/session/uploadFileBinary?sessionId=...&name=...`, taking
`application/octet-stream`. Its response is `{ ok, value: { receiptId, file } }`;
`file` has `attachmentId`, sanitized `name` and `bytes`. The receipt belongs to
that exact Session. A prompt uses `{ type: 'file', receiptId }` parts alongside
text. The relay never keeps file objects, and upload never chooses a destination
workspace path (the hosted edition's ADR 0016).

### Transfer contract

All four plugin calls use the existing `{ args: { request: ... } }` payload and
native-shaped `{ result: { ok, value } }` replies. They are explicitly listed in
`src/bridge.ts`; the binary route is not exposed as a general HTTP proxy.

| Method | Request | Successful value |
| --- | --- | --- |
| `teamwork/uploadStart` | `sessionId`, display `name`, declared `bytes` | `uploadId`, `chunkBytes` |
| `teamwork/uploadChunk` | `sessionId`, `uploadId`, raw-byte `offset`, canonical base64 `data` | acknowledged raw-byte `received` |
| `teamwork/uploadFinish` | `sessionId`, `uploadId` | native `receiptId` and `file` |
| `teamwork/uploadCancel` | `sessionId`, `uploadId` | empty object; also releases a completed plugin receipt |

`teamwork/configuration` advertises `uploads` with `maxFiles`, `maxFileBytes`,
`maxMessageBytes`, `chunkBytes` and `extensions`. The phone reads these before
opening its picker. Missing support yields an update explanation; a failed
capability read can be retried. File picking uses Expo SDK 55's
[DocumentPicker](https://docs.expo.dev/versions/v55.0.0/sdk/document-picker/)
with cache copies and [FileSystem](https://docs.expo.dev/versions/v55.0.0/sdk/filesystem/)
file-handle reads; web development uses Blob slices and never localStorage.

Start passes native session admission under the pairing identity. Uploads may
proceed while the agent is busy or its model is unavailable; desktop readiness
is enforced when Send submits a new prompt. The plugin binds each transfer to
that pairing and session. Chunks must be ordered, canonical and within the
declared and actual byte limits. A bounded stream feeds DSH with backpressure; neither app nor
plugin concatenates the whole file into base64. Finish returns only after DSH
stores the exact declared byte length. The plugin validates per-message limits
against its completed receipt metadata before forwarding a new prompt.

### Limits and recovery

- Product limits: five files, 20 MiB each and 50 MiB per message, with the
  supported extensions advertised by the plugin. This slice excludes images,
  archives, audio and video.
- Transport: 256 KiB raw chunks and one unacknowledged chunk at a time. One
  active transfer per pairing and two per host, with a 60-second idle timeout
  and five-minute total timeout. The existing 1 MiB WebSocket-message limit
  and 300 phone frames per ten seconds remain unchanged.
- Cancel, backgrounding, screen disposal, detach, relay loss and revocation stop
  in-flight intake. The app retains the draft for manual retry. Completed
  receipts are valid only for their original session and plugin link, expire
  after ten minutes, and are released on accepted submission. Pending upload
  and receipt entries are capped at 100 per host. DSH may retain stored but
  unsent objects; plugin cleanup does not delete another message's files.
- One immutable submission retains a native `requestId`. DSH recognizes the
  accepted id in queue or history before resolving its retired receipts.
  The bridge permits that exact confirmation before its busy/readiness check;
  a different request must pass the usual checks. An ambiguous acknowledgement
  locks the outgoing text and attachment list until a safe retry confirms it.
  A separate confirmation action remains available while the agent is running.
  In-flight retries of the same pairing/session/request id share one native
  dispatch, covering the period before queue/history can prove acceptance.
- Interrupted files restart from byte zero; valid completed receipts are reused.
  An expired receipt clears the app's cached receipt set. The separate Retry
  upload action transfers those files again. Cancellation and upload retries never
  submit a prompt; Send becomes available after every receipt is ready.
  No byte-level reconnect resume or background completion is promised. A
  new-session draft also retains its target and selected configuration across
  computer switches; returning to an unchanged draft reuses that session.
  Draft files belong to their computer/session, are released when
  removed or signed out, and follow the existing in-memory draft policy.
  Cache copies older than 24 hours are removed at startup; app-kill recovery is
  not promised. Original documents and DSH workspace files are never deleted.

### Images remain planned

The Teamwork adapter currently declares `input: ['text']`, and the shared model
configuration has no modality metadata. Image receipt support in DSH does not
by itself enable team-model vision. Photo library, camera, local previews and
HEIC conversion wait for actual capability reporting and real-device tests.
Team-model images also require upstream shared-model metadata, plugin
propagation and a real gateway test including image encoding plus conversation
history within the gateway's existing 4 MiB request budget. Shared changes land
upstream before merging here. The phone must preserve the draft when the
selected model cannot accept an image.

## Push notifications

- **What triggers one:** the plugin listens, first in line, to DSH's
  `user-questions/request` and `approval/request` waterfalls and hands each on
  untouched. Every one it sees becomes a `waiting` frame, and the relay pushes
  to that host's confirmed pairings that gave a token and are not connected,
  at most once per pairing a minute.
- **How a pairing gets a token:** after it is confirmed, never with the code.
  The phone asks on the pairing's success screen, or for every computer from
  its Me tab, and sends `PUT /relay/pairings/{id}/push` with
  `{ pushToken, locale }` to turn it on or `{ pushToken: null }` to turn it
  off. Only the handset the pairing is bound to, on its account, reaches it;
  a revoked pairing is 404. The phone's list says only `push: true|false`,
  never the token.
- **What a push says:** only that something waits on a computer, in the language the phone gave with its token. It never carries the
  question itself or a session id. Tapping selects the computer; its pending
  conversations are then read over the encrypted connection.
- **How it is sent:** through Expo's push service for the first version.
  Mainland China is a question of the hosted edition's positioning, and is answered before the first
  Android release there.

## Validation and release constraints

The relay tests cover same-account routing, pending handshake admission,
plaintext refusal, host isolation, revocation, takeover, notification metadata
and rate limits. Device isolation and legacy migration tests run on every
reachable dialect, including pending handshakes and independent same-host pairings. Plugin tests cover the NIST AES-256-GCM vector, Noise key
bootstrap, large-record framing, async ordering, pinned-key substitution,
commitment/ciphertext tampering, replay, reflection, usage limits, cipher failure,
closure during pending decrypt and local device trust. The cross-repository
integration suite checks the mobile wire copy against the plugin source and
drives the real Go relay between the actual mobile adapter with Expo's shipped
WebCrypto implementation and the desktop Node/OpenSSL backend. Only Expo's web
module registration is shimmed; its AES implementation is not mocked.

- Update relay, plugin and app together; merge the companion plugin before
  running CI against its main branch. Existing plaintext pairs need verification;
  the AES cipher change preserves identity seeds. The device-admission migration
  20261115065911_relay_device_credential adds device_key_hash and deletes unbound
  legacy pairings; verify each phone again on upgrade. The identity seeds,
  desktop histories and files are preserved. AUTH_SECRET rotation likewise
  invalidates credential hashes and requires re-pairing.
- The transport depends on trusted endpoint software. A hostile web server can
  replace its own development web client; production promises apply to the
  native app and installed desktop plugin.
- Physical iOS/Android verification, performance on representative phones and
  independent protocol review remain required before a store release.
- Notification delivery still requires APNs and Firebase credentials in the
  app's EAS project. Mainland-China Android availability remains an open question.
- DSH's experimental Remote API and approval behavior must be revalidated when
  its pinned version changes. No relay-side content audit or content search
  can operate on encrypted payloads.

## My DSH in the web console

A member uses their own computers from the browser, as the phone app does, and
sees and revokes every device paired with them. It is the web console's third
way to reach a DSH, beside Team DSH ([shared-dsh.md](shared-dsh.md)) and, in
the hosted edition, Cloud DSH.

- **Workspace → My DSH**, `/teams/{teamId}/my-dsh[/{hostId}[/{sessionId}]]`
  and `/teams/{teamId}/my-dsh/{hostId}/devices`
  (`apps/web/src/pages/team/my-dsh.tsx`), in the same three columns as Team
  DSH, whose parts it shares (`dsh-session.tsx`). Those parts speak to this
  browser's relay unless a page provides another client
  (`SessionClientContext`), as an edition does for a computer its server
  reaches itself. It is listed while the
  account has at least one recorded host, in every team alike: the computers
  are the person's, not a team's.
- **The second column lists the account's computers**: name, operating system,
  online or offline, whether this browser is paired with it, and beside each
  the number of devices paired with it, which opens its devices page. The list
  is read again every ten seconds, so a computer coming online or going away
  moves the page along by itself. The open one shows its sessions beneath it
  once it is online and this browser is paired.
- **The third column** follows the computer's state, one at a time, and only
  the last offers a session: offline (open DSH on it, or remove the
  computer);
  online but not paired with this browser (the six-letter code from the
  Teamwork panel's Phone page, the eight-digit safety code to compare, then
  approval on the desktop: "Pairing" above, unchanged); paired and connecting,
  until the computer answers over the encrypted channel with its sessions or
  its PIN state; the channel failed, with a retry; the computer's PIN,
  `owner`'s; and then a session, or a new one started by its first message.
  Above it, the computer's name with its operating system and DSH version on
  the left, and on the right whether it is online (green) or offline (grey,
  with when it was last seen); the list marks each computer the same way.
- **The devices page** takes the third column: every pairing of the account to
  the computer, the phone app's and every browser's, with its name, status,
  last use and whether it pushes, this browser marked, each removable.
- **A new session** offers the computer's folders, presets and models (with a
  model's reasoning efforts where it has them) before its first message, and a
  session's model and effort change while it is idle, through
  `teamwork/configuration` and `teamwork/selectModel` as the app does; a plugin
  that reports none leaves the computer's defaults.
- **A session** is followed as on the phone: a snapshot that fits the
  channel, "Show earlier messages" for what came before it, and a follow that
  comes back by itself after the socket, the channel or the computer drops
  ("Frames" above).
- **The server** ([ADR 0048](../adr/0048-the-console-manages-every-device.md)):
  `GET /relay/hosts` answers the console's session cookie alone, with the
  account's hosts, whether each socket is open, `last_seen_at`, `dsh_version`,
  `os` and every pairing of the account to each, `current` when its handset
  credential is this browser's. `DELETE /relay/pairings/{id}` from that
  session revokes any pairing of the account to its own computers; an app's
  Bearer stays handset-scoped. Another device's pairing is revoked through the
  relay alone, as for an offline desktop (step 6 above).
  `DELETE /relay/hosts/{id}`, from that session alone, forgets one of the
  account's computers with its pairing codes and every pairing to it: one no
  longer used, or a record left by signing in again (a new `clientId`). A
  connected computer is refused with `host_online`, since its next hello would
  only record it again; one that connects later is recorded anew, under a new
  id, with nothing paired. Its phones hear `revoked` at once, and the desktop
  drops their trust when it next lists its pairings, as after any revocation.
- **Not built:** a team admin seeing a member's computers; telling a member
  their DSH or plugin is older than the team pins; push to a browser.
- **Verified by** `server/e2e`'s relay test, which pairs and passes encrypted
  calls once as the app and once as the console (a cookie from this site, no
  token); its personal pairing test, where `packages/relay-client`, as the
  console runs it, pairs with the plugin's own pairing code through the code,
  the safety code and the desktop's approval; and `server/relay/console_test.go`, which pins the console's reach:
  its own computers' pairings and records only, from this site only, and none
  of an app token's.

## Open questions

- **Several computers per member** (a question of the hosted edition's positioning). The schema
  allows several hosts. The app's first screen lists them, and opens the only
  one directly when there is one.
- **How long a pairing lasts with no use.** Expiring after 90 days idle is
  the proposal.
- **Whether the app's token should be shorter-lived than the plugin's.** The
  pairing is the revocable gate, so 30 days is acceptable to start.
- **The relay's region**, on the hosted service: the same question as the
  service's own.

## How done is verified

- **End-to-end test (steps 3 and 4).** It runs in CI for steps 3 and 4: a real
  DSH with the teamwork plugin and a fake model, the relay, and a scripted phone
  client. It asserts that a session is created, prompted and followed, that a
  question is answered from the phone, and that the turn completes.
- **Refusals in the same test.** A method off the list, a revoked pairing, and
  another member's token are each refused.
- **Revocation timing.** Revoking a pairing closes its socket within one
  second.
- **Manual check before a release.** On a real phone, over a mobile network, a
  member pairs, drives a session, and answers an approval.
