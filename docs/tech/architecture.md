# Architecture

> **Status:** Current · **Updated:** 2026-11-27

How the pieces fit: the data flow, a request through the team API, the two
ways to sign in, the model gateway and what is expensive to change. The rules
live in `CLAUDE.md`; this file shows the mechanism behind them.

The gateway records community usage and exact reference points in
`server/internal/usage`, with immutable team model rates (ADR 0022).
The [usage and budget reference](usage-budgets.md) describes atomic scope
reservations, calendar limits, explicit recovery and notifications (ADR 0023). These capabilities
belong to community core ([ADR 0021](../adr/0021-community-usage-and-budgets.md)).
Optional model funding participates in the same accounting transaction through
`edition.Host`; protected routes fail closed without their registered owner
([ADR 0024](../adr/0024-atomic-model-funding.md)).

Edition team provisioning uses `Host.SubscribeTeams` (ADR 0026): callbacks
borrow the creation/join transaction and return errors before either side
commits. Creation carries the true creator once; accepted invitations and
password-admin additions emit only actual joins. No subscriber means no
extension work or historical replay. `Host.CreateSystemTeam` and
`Host.JoinMember` add a sign-in-less owner and an ordinary member idempotently
for an edition's public demonstration team, with a `System` event mark rather
than an ordinary creator's acquisition lifecycle.

A seeded content reset replaces member content in place and increments
`teams.content_generation`; it never deletes the team, memberships, models,
usage or financial records. A write admits the generation and checks it before
commit (`server/internal/contentfence`), so a late write fails with
`team_resetting` rather than surviving the reset. Object writes precede the
transaction and unreferenced bytes are collected after it (ADR 0073).

An edition may serve a domain's subdomains of its own (`Host.ServeSubdomains`):
every request whose Host is under that domain reaches the edition's handler
before the canonical-host redirect and every route, keeping the security
headers. APP_URL's host and its parents are refused, so it never shadows the
site; the premium edition serves its cloud computers' DSH web there.

## Data flow

New teams receive a built-in assistant preset in their creation transaction.
It inherits the session model until an administrator selects a team model. The
plugin exposes team-bound read/sync tools. The [team assistant plan](team-assistant.md)
describes reviewed sharing, private packages, publication history and restoration.

```
DSH + plugin ──Bearer──► server /api/configs, /api/llm/*  ──► ent ──► SQLite, Postgres or MySQL
                               │
                               └── /api/llm/chat/completions ──► the team's model provider

browser ──cookie──► server /teams, /plugin (the embedded console), /api/*
agent   ──MANAGE_API_KEY──► /api/admin/*, where premium/ adds it
```

One binary serves everything: the API, the console it embeds and the
prerendered public pages ([ADR 0014](../adr/0014-one-go-binary.md)).
The plugin (`@dsh-teamwork/dsh-teamwork`, its own repository) never reaches the
database or a provider directly. It syncs `GET /api/configs` — every team the
member is in ([ADR 0013](../adr/0013-one-person-many-teams.md)) — into a local
cache, registers each team's models and presets in DSH next to the member's
own, and sends every team-model call to the gateway with its Bearer token.

A member works with the team from DSH in two ways: the `/teamwork` command and,
in DSH's web shell, a Teamwork entry in the sidebar. The panel signs in, shows
the team, its role and sync state, and applies the team's presets, models and
pinned plugins to a session. It calls the plugin's own host routes
(`api/teamwork/*`), which run the same functions as the command, so the Bearer
token never reaches the browser. Publishing and members also have pages in the web
console, one page per task under `/teams/{teamId}`: the member's `home`, the admin's `overview`, `models`
(providers from `packages/shared/src/provider-catalog.ts`, and team models), `presets` (from
`lib/preset-templates.ts` or blank), `plugins`, `members`, `sharing` and `history`. The panel links
there for management; separate host-approved agent tools call the same authorized server operations. Its components
come from `@dsh-teamwork/ui`, the shared component library kept in the plugin
repository's `ui/` until it moves to `dsh-teamwork/dsh-teamwork-ui`.

## Components

Instance administration is shared by all editions: [system management](system-management.md) describes `/manage`, instance operators and `SERVICE_ROLE` isolation. Editions add commercial routes and compose the shared console.

| Component | Owns | Lives in |
| --- | --- | --- |
| Server | The binary: configuration, migrations, every route, the embedded console | `server/` (`app/`, `cmd/dsh-teamwork`) |
| Team rules | Membership, invitations, configuration and its references, providers | `server/internal/team` |
| Model gateway | Resolving a configuration id to a provider call | `server/internal/gateway` |
| Usage and budgets | Price snapshots, point/token reservations, settlement, recovery and notices | `server/internal/usage` |
| Sign-in | Google, emailed codes, passwords, identities, sessions and plugin tokens | `server/internal/auth` |
| Wire | Request shapes, their validation and the error codes | `server/internal/wire`, `api/openapi.yaml` |
| Schema | Every table and the migrations of three dialects | `server/internal/db` |
| Web | The team pages, sign-in, `/plugin` and the public pages, prerendered and embedded | `apps/web` |
| Extension point | What a closed package registers: routes, tables, migrations | `server/edition` |

## Data model

| Table | What it holds | Invariant |
| --- | --- | --- |
| `users` | An account: email, name, image, locale | Created by the first sign-in through any door, or by an admin adding a member by email |
| `identities` | Each door that reached an account: `provider`, `subject` | `(provider, subject)` unique; an account is joined by email only on an email the door verified |
| `teams` | A name and `content_generation`, incremented by a seeded reset | A write admitted at an older generation cannot commit after the reset |
| `memberships` | Who is in which team, as `admin` or `member` | `(user_id, team_id)` is the key: a person may be in several teams, once in each (ADR 0013) |
| `team_configs` | `kind` (`model`, `preset`, `plugin`), `name`, `data`, `version` | Unique per team, kind and name; `data` validated by `wire.ConfigInput` on every write; an edit names its `version`; a model or plugin a preset uses cannot be removed (`model_in_use`, `plugin_in_use`) |
| `invites` | A SHA-256 of a single-use token, its expiry and use | The token itself is never stored |
| `verification_codes` | Emailed codes, as an HMAC under `AUTH_SECRET` | Ten minutes, at most five checks |
| `rate_windows` | One counter per limit and key | Spent by a conditional update, never under a lock |
| `team_providers` | A team's provider: `name`, `base_url`, and `key_cipher`, its key sealed under `PROVIDER_KEYS_SECRET` | Unique per team and name; the key is never stored in clear or answered; a provider a team model calls cannot be removed |
| `passwords` | One scrypt hash per user and a must-change mark | Only where `SMTP_URL` is unset; the hash names its own parameters |
| `schema_migrations` | Every migration applied, with its checksum | Append-only; a changed checksum stops the start |

A preset references a team model by id (`modelConfigId`) or names its own
provider and model, never both; its `pluginDependencies` pin plugin entries of
the same team at their exact version, checked when the preset is written.


Resource sharing adds `resource_submissions` (frozen proposals and decisions),
`config_revisions` (immutable publication content) and `plugin_packages`
(private archive metadata). Package bytes live under the persistent data
directory. Config writes, approval and history commit together; history is
retained after deletion. The [team assistant reference](team-assistant.md)
describes exact dependency pins, access checks, export and restoration.

An account is deleted by its owner (ADR 0039): refused while it administers a
team with others in it, until the role is handed over; a team it is alone in
goes with it, rows and package bytes; elsewhere only the membership goes, and
the team keeps its records under a former member. A team is deleted by its
admin (ADR 0056), with everyone in it and the same rows.

## A request through the team API

1. `requireUser` finds the caller: the plugin's `Bearer` first, the session
   cookie second; no identity is `401 { "error": "unauthorized" }`. A write a
   cookie authorizes must come from `APP_URL`'s origin (`403 cross_origin`).
2. The body is read with a limit (64 KiB, 4 MiB for the gateway; over it is
   `413 payload_too_large`) and validated by its `wire` type; a failure is
   `400 { "error": "invalid_request", "issues" }`.
3. The `internal/team` function reads the caller's membership in the team the
   URL names — that pair, user and team — and acts on that team only. A team
   the caller is not in is `404 team_not_found`, like one that does not exist.
   A refusal is a `wire.Error` → `{ "error": <code> }`; anything unexpected is
   logged and is `500 internal_error`. Every response is held to
   `api/openapi.yaml` by the Go tests.

| Route | Who | What |
| --- | --- | --- |
| `GET /api/teams` | anyone signed in | The teams the caller is in, with their role in each |
| `POST /api/teams` | anyone signed in | Create a team; the caller is its admin |
| `GET /api/teams/:teamId` | member | The team, the caller's role, its members |
| `DELETE /api/teams/:teamId` | admin | Delete the team with everyone in it; `confirm` is its name |
| `DELETE /api/teams/:teamId/membership` | member | Leave (an admin cannot) |
| `POST /api/teams/:teamId/members`; `DELETE /api/teams/:teamId/members/:userId` | admin | Add by email (passwords only), remove |
| `GET`, `POST /api/teams/:teamId/invites`; `DELETE …/invites/:id` | admin | List, create (token shown once), revoke |
| `POST /api/invites/redeem` | anyone signed in | Spend a token and join its team; a second seat in the same team is refused |
| `GET /api/configs` | anyone signed in | `{ teams: [{ teamId, teamName, role, configs }] }` — the snapshot the plugin caches |
| `GET`, `POST /api/teams/:teamId/configs`; `PATCH`, `DELETE …/configs/:id` | member reads, admin writes | List; publish, edit (with `version`), delete |
| `GET`, `POST /api/teams/:teamId/providers`; `PUT`, `DELETE …/providers/:id` | admin | Providers, never a key |
| `GET /api/teams/:teamId/model-catalog?provider=` | admin | One provider's models, read from its `/models` |
| `POST /api/teams/:teamId/model-metadata/lookup` | admin | Live form suggestions from Models.dev or OpenRouter; nothing stored |
| `POST /api/llm/chat/completions` | member | The model gateway |
| `GET`, `PATCH /api/profile`; `POST /api/locale` | anyone signed in | The account's name and locale |
| `POST /api/auth/plugin/token` | the plugin | `{ code, verifier }` → `{ token, expiresAt }` |

## Live model form suggestions

`POST /api/teams/{teamId}/model-metadata/lookup` is an admin-only transient
lookup against fixed Models.dev or OpenRouter URLs, with a request deadline
and bounded responses. Pricing lookups also obtain live USD/CNY FX from
Frankfurter. There is no local catalog, cache, scheduled sync or saved mapping.
The reading is `server/modelmeta`, exported so an edition's own forms read the
same catalogues the same way; it also lists the upstreams OpenRouter routes a
model to, each with its own price (`Endpoints`), which no open form uses yet.
A provider the console lists (`packages/shared/src/provider-catalog.ts`) is named
by its Models.dev provider id and sits at the address Models.dev states for it,
except where an entry says why not, so a team's provider is read there under
its own name; a renamed second account is matched to its entry by address.
For Models.dev, a provider the catalog does not name (a team's own proxy)
searches every provider for the exact model id instead of a substring. The
console fills known fields into the form in one click, only from the one
candidate whose id is the model's own, and says where they came from with an
undo; no match or several leave the form alone and offer a picker. Publishing
from a provider's list does the same without a click: each ticked model is
looked up as it is ticked, and published with the limits and reference rate
its agreeing exact matches state (a missing cache rate charged as uncached
input); the models page retries every unpriced model the same way, and a
rate dialog for an unpriced model opens filled. Existing configuration and rate APIs save
only final values; the actual provider/model ID is never replaced. Model
configuration includes an optional `vision` boolean, propagated through the
plugin snapshot to image input support. The gateway remains a
chat-completions route.

## Signing in on the web

An edition may require one account-wide verification step for personal access. A primary login then issues a short-lived pending cookie. Browser verification creates a session, and phone verification authorizes only the matching PKCE handoff (ADR 0059).

Every door is a route under `/api/auth/` and ends in a session cookie, a JWE
under a key derived from `AUTH_SECRET`.

- **Google**, where `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set. `GET /api/auth/google?next=…`
  redirects to Google, which returns to `/api/auth/callback/google` and lands
  on the `next` path — only ever a path on this origin. An existing account is
  joined by email only when Google says the email is verified.
- **Email code**, where `SMTP_URL` is set. `POST /api/auth/email/send` stores
  an HMAC of a six-digit code (10 minutes, at most 5 checks, 5 codes per
  address per 15 minutes — both limits hold under concurrent requests) and
  mails it over SMTP (the hosted service uses Resend's endpoint).
  `POST /api/auth/email/verify` signs in.
- **Password**, where it is not (ADR 0006).
  `POST /api/auth/password/sign-in` checks a scrypt hash, after spending one
  of ten guesses per account per 15 minutes. `/setup`, which the sign-in page
  offers to anyone while no password exists, claims the first account with no
  token (ADR 0070); a management process neither offers nor accepts it.
  `POST /api/teams/:teamId/members` and
  `POST /api/teams/:teamId/members/:userId/password` give an admin's member a
  first password, shown once; `/teams` and `/plugin` send its owner to
  `/password` until it is changed. The session that signed in with it changes
  it without typing it again; a session issued before an admin reset still has
  to (`auth.FirstPasswordProven`).

## Signing in from the plugin

```
DSH plugin                                    server
  │ verifier = random(32); challenge = S256(verifier)
  │ listen on http://127.0.0.1:<port>/callback
  │ print /plugin?challenge=…&redirect_uri=… ; the person opens it
  │                                           no session → /sign-in, back here after
  │                                           "Authorize" → POST /api/auth/plugin/code →
  │                                           code = JWE{email, challenge}, 2 min
  │◄── browser: GET /callback?code=… ─────────  (or the person pastes /teamwork authorize <code>)
  │── POST /api/auth/plugin/token {code, verifier} ──►
  │                                           S256(verifier) == challenge ?
  │◄── { token, expiresAt } ─────────────────  token = JWE{email}, its own salt, 30 days
  │ keep the token in memory; send it as Bearer
```

A code read off the screen is useless without the verifier, which never leaves
the plugin. A link alone mints nothing: the code exists only after the signed-in
person presses Authorize. Why it is shaped this way:
[ADR 0001](../adr/0001-plugin-sign-in.md).

The code goes back through `&redirect_uri=…` in two cases. The plugin's own
loopback listener, `http://127.0.0.1:<port>/…`, is accepted on every deployment
([ADR 0012](../adr/0012-the-plugin-gets-its-code-back-on-loopback.md)). The
official phone app's address, exactly `dshteamwork://sign-in`, is accepted on
every deployment too ([ADR 0046](../adr/0046-every-server-sends-the-app-its-code.md)). For either, pressing
Authorize sends the browser to `redirect_uri?code=…` and keeps the code on
screen in case it does not arrive. Any other address makes the link invalid.
Without a `redirect_uri`, the code is shown for pasting.

## The model gateway

`POST /api/llm/chat/completions` takes an OpenAI Chat Completions body whose
`model` is a team configuration id. The gateway:

1. finds the team the id belongs to and requires the caller's membership in
   **that team**; a missing id and another team's id are the same `403`. A
   preset follows its `modelConfigId` to a model of the same team, and
   everything after this is that team's (ADR 0013);
2. caps output: `max_tokens` defaults to the model's `maxTokens`, and a caller
   asking for more is `400`;
3. accepts a `reasoning_effort` only when it is one of the model's own
   `reasoningEfforts`, and `400` otherwise; without one the provider's default
   applies. For OpenRouter it becomes `reasoning.effort`; for DeepSeek it
   also turns thinking on. DeepSeek thinks by default, so every call to it
   gives each replayed assistant message the `reasoning_content` thinking
   mode requires, empty where the plugin holds none;
4. takes the team's provider of that name from `team_providers` — the base
   URL its admin entered, with no credentials, query or fragment, and the key
   decrypted from `key_cipher` (AES-256-GCM under `PROVIDER_KEYS_SECRET`,
   bound to the team and the name). The address must pass the network rule of
   `server/internal/team/network.go` (ADR 0006): public https, or with
   `ALLOW_PRIVATE_PROVIDERS=true` loopback and private networks too, plain
   http only there. Link-local, carrier-grade NAT and unspecified addresses
   count as private. The rule is checked on save, before the call, and by the
   dialer as it connects, so a rebinding answer is refused;
5. forwards only the inference fields (`messages`, `tools`, `stream`,
   `temperature`, …) following no redirect and waiting at most 120 s for the
   provider's headers, and answers
   the provider's body with none of its headers. A provider failure is `502`
   (`429` stays `429`) and its body is dropped.

## Deployment

One binary, three ways to run it (`README.md`, "Self-hosting"): `npx
@dsh-teamwork/server`, a release binary, or `compose.yaml` over
`server/Dockerfile`. With nothing configured it keeps a SQLite file and
generated secrets in its data directory; `DATABASE_URL` points it at Postgres
or MySQL. It applies every pending migration before it serves. The hosted
service runs the closed edition of the same binary, deployed as described
where `premium/` exists.

## What is expensive to change

- **The wire the plugin speaks**: `/api/configs`'s snapshot,
  `/api/auth/plugin/token`, and the gateway's request shape. An installed
  plugin is a client this repository cannot update.
- **Token format**: plugin tokens are JWEs under `AUTH_SECRET`; rotating the
  secret signs every member out of every plugin at once.
- **`team_configs.data`**: stored JSON written by older schemas has to stay
  readable once teams depend on it.
- **Several teams per person**: `memberships` keyed by `(user_id, team_id)`,
  and every team route and rule carrying the team id (ADR 0013).
- **`PROVIDER_KEYS_SECRET`**: every stored provider key is sealed under it.
  Losing or changing it means every team enters its keys again.
- **The migration history**: three dialects' directories, applied in order and
  checked by checksum; a migration another database applied is never edited.
- **The npm packages' names**: `@dsh-teamwork/server` and its platform
  packages are what a self-hoster's `npx` resolves.
