# Architecture

> **Status:** Current · **Updated:** 2026-11-11

How the pieces fit: the data flow, a request through the team API, the two
ways to sign in, the model gateway and what is expensive to change. The rules
live in `CLAUDE.md`; this file shows the mechanism behind them.

## Data flow

```
DSH + plugin ──Bearer──► apps/web /api/team*, /api/llm/*  ──► @dsh-teamwork/db (Prisma) ──► Postgres, or PGlite in-process
                               │
                               └── /api/llm/chat/completions ──► model provider (key from the server's env)

browser ──cookie──► apps/web /team, /plugin, /api/*        premium/apps/manage pages
agent   ──MANAGE_API_KEY──► premium/apps/manage /api/admin/*
```

The plugin (`@dsh-teamwork/dsh-teamwork`, its own repository) never reaches the
database or a provider directly. It syncs `GET /api/team/configs` into a local
cache, registers the team's models and presets in DSH next to the member's own,
and sends every team-model call to the gateway with its Bearer token.

## Components

| Component | Owns | Lives in |
| --- | --- | --- |
| Web app | The site, the team console, the plugin sign-in page, the whole API | `apps/web` |
| Team rules | Membership, invitations, configuration and its references | `apps/web/src/lib/team.ts` |
| Model gateway | Resolving a configuration id to a provider call | `apps/web/src/lib/llm-gateway.ts` |
| Operator console | Google + `ADMIN_EMAILS`; `/api/admin/*` | `premium/apps/manage` |
| Schema | Every table and migration; Postgres or, without `DATABASE_URL`, PGlite migrated on first connect | `packages/db` |
| Wire schemas, sign-in | `ConfigInputSchema` and the team API's types; NextAuth | `packages/shared` |

## Data model

| Table | What it holds | Invariant |
| --- | --- | --- |
| `users` | One profile per verified email (`authId`) | Created on the first authenticated request (`ensureUser`) |
| `teams` | A name | — |
| `memberships` | Who is in which team, as `admin` or `member` | `user_id` is the key: one team per person |
| `team_configs` | `kind` (`model`, `preset`, `plugin`), `name`, `data`, `version` | Unique per team, kind and name; `data` parsed by `ConfigInputSchema` on every write; an edit names its `version` |
| `invites` | A SHA-256 of a single-use token, its expiry and use | The token itself is never stored |
| `verification_codes` | NextAuth email codes, as an HMAC | — |
| `team_providers` | A team's provider: `name`, `base_url`, and `key_cipher`, its key sealed under `PROVIDER_KEYS_SECRET` | Unique per team and name; the key is never stored in clear or answered; a provider a team model calls cannot be removed |
| `passwords` | One scrypt hash per user, a must-change mark and the guesses counted against it | Only where `SMTP_URL` is unset; the hash names its own parameters |

A preset references a team model by id (`modelConfigId`) or names its own
provider and model, never both; its `pluginDependencies` pin plugin entries of
the same team at their exact version, checked when the preset is written.

## A request through the team API

1. The route calls `requireUser(request)`: the plugin's `Bearer` first, the
   session cookie second; no identity is `401 { "error": "unauthorized" }`.
2. The body is read with `readJson` (64 KiB, 4 MiB for the gateway; over the
   limit is `413 payload_too_large`). Anything that is not JSON fails the
   route's Zod schema as `400 { "error": "invalid_request", "issues" }`.
3. The `lib/team.ts` function reads the caller's membership once and acts on
   the team that row names. A refusal is `TeamError` → `{ "error": <code> }`
   with one of `TEAM_ERRORS`; anything unexpected is logged and is
   `500 internal_error`.

| Route | Who | What |
| --- | --- | --- |
| `POST /api/teams` | anyone in no team | Create a team; the caller is its admin |
| `GET /api/team` | member | The team, the caller's role, its members |
| `DELETE /api/team/membership` | member | Leave (an admin cannot) |
| `DELETE /api/team/members/:userId` | admin | Remove a member |
| `GET`, `POST /api/team/invites`; `DELETE /api/team/invites/:id` | admin | List, create (token shown once), revoke |
| `POST /api/invites/redeem` | anyone in no team | Spend a token and join |
| `GET /api/team/configs` | member | `{ teamId, configs }` — the snapshot the plugin caches |
| `POST /api/team/configs`; `PATCH`, `DELETE /api/team/configs/:id` | admin | Publish, edit (with `version`), delete |
| `GET /api/team/model-catalog[?provider=]` | admin | Configured providers, or one provider's models |
| `POST /api/llm/chat/completions` | member | The model gateway |
| `POST /api/auth/plugin/token` | the plugin | `{ code, verifier }` → `{ token, expiresAt }` |

## Signing in on the web

- **Google.** `startGoogle(next)` redirects to Google, which returns to
  `/api/auth/callback/google` and lands on `returnPath(next)` — only ever a
  path on this origin.
- **Email code**, where `SMTP_URL` is set. `sendCode(email)` stores an HMAC
  of a six-digit code (10 minutes, at most 5 checks, 5 codes per address per
  15 minutes — both limits hold under concurrent requests) and mails it over
  SMTP (the hosted service uses Resend's endpoint).
  `verifyCode(email, code, next)` signs in and redirects.
- **Password**, where it is not (ADR 0006). `signInWithPassword(email,
  password, next)` checks a scrypt hash, after spending one of ten guesses per
  account per 15 minutes. `/setup?token=…`, printed by
  `src/instrumentation.ts` at start, claims the first account while no
  password exists. `POST /api/team/members` and
  `POST /api/team/members/:userId/password` give an admin's member a first
  password, shown once; `/team` and `/plugin` send its owner to `/password`
  until it is changed.

## Signing in from the plugin

```
DSH plugin                                    apps/web
  │ verifier = random(32); challenge = S256(verifier)
  │ print /plugin?challenge=… ; the person opens it
  │                                           no session → /sign-in, back here after
  │                                           "Authorize" (a server action) →
  │                                           code = JWE{email, challenge}, 2 min, shown on the page
  │ person pastes: /teamwork authorize <code>
  │── POST /api/auth/plugin/token {code, verifier} ──►
  │                                           S256(verifier) == challenge ?
  │◄── { token, expiresAt } ─────────────────  token = JWE{email}, its own salt, 30 days
  │ keep the token in memory; send it as Bearer
```

A code read off the screen is useless without the verifier, which never leaves
the plugin. A link alone mints nothing: the code exists only after the signed-in
person presses Authorize. Why it is shaped this way:
[ADR 0001](../adr/0001-plugin-sign-in.md).

## The model gateway

`POST /api/llm/chat/completions` takes an OpenAI Chat Completions body whose
`model` is a team configuration id. The gateway:

1. re-reads the caller's membership and looks the id up **in that team only**
   (a preset follows its `modelConfigId` to the team model);
2. caps output: `max_tokens` defaults to the model's `maxTokens`, and a caller
   asking for more is `400`;
3. takes the team's provider of that name from `team_providers` — the base
   URL its admin entered, with no credentials, query or fragment, and the key
   decrypted from `key_cipher` (AES-256-GCM under `PROVIDER_KEYS_SECRET`,
   bound to the team and the name). The address must pass the network rule of
   `src/lib/provider-network.ts` (ADR 0006): public https, or with
   `ALLOW_PRIVATE_PROVIDERS=true` loopback and private networks too, plain
   http only there. Link-local, carrier-grade NAT and unspecified addresses
   count as private. The rule is checked on save, before the call, and by the
   connection's own DNS lookup, so a rebinding answer is refused;
4. forwards only the inference fields (`messages`, `tools`, `stream`,
   `temperature`, …) with `redirect: 'error'` and a 120 s timeout, and answers
   the provider's body with none of its headers. A provider failure is `502`
   (`429` stays `429`) and its body is dropped.

## The operator console

Pages call `requireAdminPage()`: no identity → `/login`, an identity not on
`ADMIN_EMAILS` → `/denied`. The console admits only Google sessions
(`emailCodes: false`). `/api/admin/*` goes through `withAdminRead` (a session or
the key) or `withAdminWrite` (a session, or the key with an `x-agent-id`; same
origin, a JSON body). Both re-read `ADMIN_EMAILS` on every request. The console
never calls `ensureUser`, so signing in to it creates no `User` row.

## Deployment

Railway: `web` (`alpha.dshteamwork.com`) and `manage`
(`manage.dshteamwork.com`) services from this repository, one Postgres
(`premium/docs/ops/deployment.md`). Provider keys are each team's, in the
database; `PROVIDER_KEYS_SECRET`, which seals them, is a variable on `web`
only.

## What is expensive to change

- **The wire the plugin speaks**: `/api/team/configs`'s snapshot,
  `/api/auth/plugin/token`, and the gateway's request shape. An installed
  plugin is a client this repository cannot update.
- **Token format**: plugin tokens are JWEs under `AUTH_SECRET`; rotating the
  secret signs every member out of every plugin at once.
- **`team_configs.data`**: stored JSON written by older schemas has to stay
  readable once teams depend on it.
- **One team per person**: `memberships.user_id` as the key.
- **`PROVIDER_KEYS_SECRET`**: every stored provider key is sealed under it.
  Losing or changing it means every team enters its keys again.
- **A PGlite data directory**: a team's whole database in one directory, owned
  by one process. Its `_prisma_migrations` rows match Prisma's, so a dump
  restored into Postgres keeps migrating with `pnpm db:deploy`.
