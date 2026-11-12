# Community edition split

> **Status:** Plan — Phases 0 to 2 done · **Updated:** 2026-11-12

How the open part of this repository becomes the public
`dsh-teamwork/dsh-teamwork-platform` (ADR 0005), and how it then runs from
one command (ADR 0006). The plan covers:

- what moves where;
- the three experiments that come first;
- the one-time split;
- running from `npx` with nothing else installed;
- how the two repositories stay in step afterwards.

## The route in one paragraph

**Everything closed moves under paths the public repository never has; then the
rest is published with a fresh history.** Before the split, this repository is
reorganised in place:

- the closed code goes under `premium/`;
- the parts of the web app that only the hosted service needs move into one
  route group;
- the closed tables go into `.prisma` files of their own.

The open remainder is then exported as the public repository's first commit.
This repository records that commit as merged, so that every later public
commit merges here without a conflict.

From then on the rules are:

- an open change is made in the public repository and merged here from
  `upstream`;
- a check fails this repository's gate when any open path differs from
  `upstream/main`.

## Goal

1. **Anyone can self-host the community edition from a clean clone.**
   `docker compose up` gives one team the whole of today's product:
   - sign-in by an emailed code over SMTP, with Google optional;
   - teams and invitations;
   - team configuration;
   - the model gateway;
   - `/teamwork login` and `/teamwork sync` from DSH.

   It runs with no Google, PostHog or Resend account.
2. **The public repository holds no closed code, no internal document and no
   secret.** Its history starts at the split.
3. **This repository is the public one plus `premium/`.** A merge from
   `upstream` never conflicts, apart from the lockfile, which is regenerated
   rather than merged.
4. **The hosted service behaves as before.** It is deployed from this
   repository, on the same Railway services, and the email transport is the
   only change.

## Non-goals

- **Building any closed feature.** Organisations, company sign-in, audit and
  cloud execution follow `premium/docs/tech/saas-route.md`. Their extension points
  come with them (ADR 0005).
- **A supported private deployment of the enterprise edition** (ADR 0004).
- **Publishing the server's packages to npm.** The community edition is run
  from its repository, not installed as a library.
- **Changing the plugin's wire.** The release waits for it to settle; this
  plan does not settle it.
- **Keeping this repository's history in the public one.** The history carries
  internal documents, so the public repository starts fresh.

## What goes where

| Part | Public `dsh-teamwork-platform` | This repository only |
| --- | --- | --- |
| `apps/web` | The home page and share card, sign-in, `/team`, `/plugin`, `/account`, every `/api/*` route, the model gateway, locale, robots and sitemap; `/privacy` and `/terms` from a deployment's `LEGAL_DIR` | The hosted service's legal text (`premium/docs/legal/`): see "The hosted home page" |
| `apps/manage` | — | Moves to `premium/apps/manage` |
| `packages/db` | `prisma/schema/` with today's models; every migration so far | Closed models in `prisma/schema/premium-*.prisma`; their migrations named `<timestamp>_premium_<name>` |
| `packages/shared` | All of it, including the analytics client, which stays off unless configured | — |
| Brand | `docs/brand/icon.svg`, `docs/design.md`, the exported icons; the name and mark are not licensed (ADR 0005) | — |
| Docs | `docs/tech/architecture.md`, `docs/tech/community-edition.md`, `docs/design.md`, `docs/ops/analytics.md`, ADRs 0001, 0002 and 0005 | `premium/docs/`: positioning, the SaaS route, the rest of `ops/`, `legal/`, ADRs 0003 and 0004 |
| Agent instructions | `CLAUDE.md`, `AGENTS.md` | `premium/CLAUDE.md`, which an agent reads before touching `premium/` |
| Changelog | `CHANGELOG.md` for the open product | `premium/CHANGELOG.md` |
| Self-hosting | `apps/web/Dockerfile`, `compose.yaml`, a self-hosting section in `README.md` | — |
| Licence and contributing | `LICENSE` (Apache-2.0), `NOTICE`, a README section asking for the DCO sign-off, CI on pull requests | — |
| Deployment | — | `railpack.json`, Railway services, `premium/docs/ops/deployment.md` |

**The closed paths, all of them:**

- `premium/**`;
- `apps/*/src/app/(premium)/**`;
- `packages/db/prisma/schema/premium-*.prisma`;
- `packages/db/prisma/migrations/*_premium_*`.

**A premium model refers to an open row by its id alone**, with no Prisma
relation and no foreign key (experiment 2):
- Prisma requires the opposite relation field on the open model, which would
  edit an open file.
- A foreign key the schema does not declare fails `db:drift`.

Keeping such references whole is the premium code's job. An audit row should
outlive its team anyway. Where premium rows must follow an open row's
deletion, that is an extension point, built with the first feature that needs
it.

`pnpm-workspace.yaml` and `turbo.json` list `premium/apps/*` and
`premium/packages/*` in both repositories. pnpm and turbo skip a glob that
matches nothing, so the public repository carries the line harmlessly and
neither file ever diverges.

## The hosted home page

**Superseded by [ADR 0007](../adr/0007-one-domain-one-app.md).** A closed
`premium/apps/site` once served the landing page, `/privacy` and `/terms` on
the root domain, because an open page linking legal text that names Shushuo
would 404 on every self-hosted instance. Now the open web app's `/` is the
landing page on every instance, the web app serves `dshteamwork.com`, and a
deployment publishes its own legal pages from `LEGAL_DIR`; the hosted service
points it at `premium/docs/legal/`.

## Order of work, and what gates what

### Phase 0: three experiments, thrown away afterwards

Each one could change the shape of the rest, so each is answered before
anything lands.

1. **The fork stays conflict-free.** Set up a scratch public repository and a
   scratch fork with a `premium/` directory and a `(premium)` route group. Replay
   three typical public changes: a new route, a dependency bump and a schema
   change. Then check:
   - `git merge upstream/main` conflicts only on `pnpm-lock.yaml`;
   - `pnpm install` regenerates the lockfile;
   - the boundary check (Phase 3, step 4) catches a deliberate edit to an open
     file.
2. **The two edition schemas.** Move `schema.prisma` into `prisma/schema/`,
   which Prisma 7 supports as a multi-file schema. Add a `premium-*.prisma` model
   whose migration is older than an open migration that lands after it. Then
   check:
   - `prisma migrate deploy` applies both on a database that already has the
     closed one;
   - `db:drift` passes in both repositories, over the open history alone and
     over both histories interleaved.
3. **Self-hosting from nothing.** On a clean machine, `docker compose up`
   starts Postgres, the web app, and Mailpit to stand in for any SMTP server.
   There is no other account. Run the whole path:
   - sign in with an emailed code;
   - create a team, invite a second address and publish a model;
   - in DSH, run `/teamwork login`, `/teamwork authorize` and `/teamwork sync`;
   - get one answer through the gateway from a stub provider.

### Phase 0 results

Run on 2026-11-10 against scratch copies of this repository: a public tree, a
fork with `premium/`, and Postgres 16 in Docker. The code was thrown away.

**1. The fork stays conflict-free: yes.**
- **Moving the console:** `apps/manage` moved to `premium/apps/manage` with
  one workspace glob; it typechecks and its 21 tests pass.
- **Recording the merge:** the public tree was recorded with
  `merge -s ours --allow-unrelated-histories`.
- **Three public changes, with the private side changing at the same time.**
  The public side made three commits:
  - a new route;
  - a new dependency;
  - a schema change with its migration.

  At the same time the private side added a dependency and a `(premium)`
  route. The merge then:
  - had no conflict at all, the lockfile included, which git merged on its
    own;
  - passed `pnpm install --frozen-lockfile`;
  - typechecked.
- **The boundary check:** it was empty after the merge, and it named the file
  when an open file was edited deliberately.
- **Findings:**
  - **Building the public tree:** `git add -A` drops a tracked file that
    `.gitignore` covers (`.claude/settings.json`), so the public commit is
    built from the tracked tree itself (Phase 3).
  - **The icon script:** `generate-icons.mjs` lists the console's icon paths,
    so the open script would name premium paths and fail its own check in the
    public repository (Phase 2).

**2. The two edition schemas: yes, with references by id only.**
- **The multi-file schema works in Prisma 7.9.1** once four things follow the
  move:
  - the generator's `output` becomes `../../src/generated/prisma`;
  - `prisma.config.ts` names the folder;
  - `assert-no-schema-drift.mjs` diffs against the folder;
  - turbo's `db:generate` input becomes `prisma/schema/**`.
- **A premium table referring to an open one** cannot use a Prisma relation or
  a foreign key; see "What goes where".
- **Migrations out of order deploy:** an open migration timestamped before an
  already-applied premium one was merged later. `prisma migrate deploy`
  applied it, `migrate status` reported the database up to date, and
  `db:drift` passed in both repositories, over the open history alone and
  over both interleaved.
- **Naming:** `prisma migrate dev --name premium_<what>` writes
  `<timestamp>_premium_<what>`, which the boundary already excludes.

**3. Self-hosting from nothing: the application path, yes; the packaging,
not yet.**
- **Setup:** a clean public tree, its sign-in switched to SMTP (nodemailer),
  ran against Postgres with a local SMTP sink and an HTTPS stub provider. It
  had no Google, PostHog or Resend configuration.
- **Thirteen steps passed:**
  - three people signed in by emailed codes;
  - the admin created a team, listed the provider's models, published a team
    model and created an invitation;
  - the second person joined with the invitation, and a reuse of it was
    refused with 409;
  - the plugin's own `TeamworkClient` ran `/teamwork login`, the `/plugin`
    confirmation, `/teamwork authorize` and `/teamwork sync`;
  - the gateway answered through the stub, with the server's key and the
    provider's model name.
- **The server log** held no error and no call to Google, PostHog or Resend.
- **Findings:**
  - **Google is not optional yet.** The provider is always registered and the
    button always shown; Phase 1 builds both only when `AUTH_GOOGLE_ID` is
    set.
  - **Analytics is already off** without `NEXT_PUBLIC_POSTHOG_KEY`.
  - **The gateway accepts only `https://` providers**, so a self-hosted model
    served over plain HTTP (Ollama, vLLM) cannot be a team model. Decided:
    plain HTTP on loopback and private networks only (Phase 1).
  - **The plugin refuses plain HTTP beyond loopback**, so a self-hosted
    instance must be served over HTTPS. The self-hosting docs say so and show
    a TLS proxy in front.
  - **The packaging was not run.** This machine could not pull a Node image
    (Docker Hub answered 429; GHCR and ECR were refused). The `Dockerfile` and
    `compose.yaml` are therefore first proven in the public repository's CI,
    in Phase 1.

### Phase 1: make the open part self-hostable, still in this repository

Done on 2026-11-10.

- **Email over SMTP.** `sendCodeEmail` sends through `SMTP_URL` with
  nodemailer, and Resend's HTTP API is gone. The hosted service uses Resend's
  SMTP endpoint, so there is one transport. `RESEND_API_KEY` is replaced by
  `SMTP_URL`, and the privacy policy's Resend line stays true. Tests pin that
  no code is logged outside development, even when the server refuses it.
- **Google is optional.** The provider and its button exist only when
  `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set, and the subtitle then
  names the emailed code alone. Analytics was already off without
  `NEXT_PUBLIC_POSTHOG_KEY`. The server side has a test for each. The
  browser's single guard has none, because the web app has no DOM test setup
  to add one to.
- **Plain HTTP to providers on private networks.** `routeFor` accepts
  `http://` only when every address the host resolves to is loopback or
  private, resolved at request time. Tests pin the private, public, mixed,
  unresolvable and mapped-IPv6 cases.
- **`apps/web/Dockerfile`, `compose.yaml`, and a self-hosting section in `README.md`.**
  The container applies the migrations, then serves.
  - **Run here, without the image's OpenSSL step.** This machine's network
    refuses the Debian mirror, so the image was built here without its
    `apt-get install openssl` step, which Prisma's warning shows is needed.
    Under compose, with an SMTP sink and a plain-HTTP stub provider on the
    host's private address, it applied all four migrations. Experiment 3's
    thirteen steps then passed against the container, and the sign-in page
    rendered no Google button.
  - **Railway built the full Dockerfile, by accident.** On the first deploy
    the Dockerfile sat at the root, and Railway built both services with it
    instead of Railpack. That gave the Dockerfile's first full build,
    `apt-get` included, and the web app served from it. The console's image
    had no console build and crashed until it was rolled back. The Dockerfile
    now lives in `apps/web/`.
  - **The scripted run is first run in CI.** The scripted run joins the
    public repository's CI in Phase 3, with the full Dockerfile, because that
    run needs the plugin's client and a browser.

**Moved to Phase 3:**
- **`LICENSE` and `NOTICE`.** At the root of this repository they would claim
  the closed code too, so they are written into the public tree at the split.
- **The DCO request** goes in a README section, not a `CONTRIBUTING.md`. The
  root may hold no other prose (`lint-docs.mjs`).

### Phase 2: move the closed parts onto closed paths

1. **Done:** `apps/manage` is `premium/apps/manage`, found through the
   `premium/apps/*` workspace glob. Its Railway service's build and start
   commands pick it by package name, so they did not change.
2. **Built:** `premium/apps/site` (`@dsh-teamwork/site`) holds the landing
   page, `/privacy`, `/terms`, the share card and the JSON-LD. The legal pages
   moved to `premium/docs/legal/`, with `pull-legal.mjs` and the privacy test.
   The site has no accounts: its locale is the cookie, then `Accept-Language`,
   and its sign-in links go to `WEB_APP_URL`. Its turbo inputs live in its own
   `turbo.json`, so the root one names no closed package. The open `/` is now
   a start page. The Railway service `dsh-teamwork-site` serves it on
   `dshteamwork.com`. Google's OAuth consent screen is pointed at its home
   page, `/privacy` and `/terms` by hand, in Google Cloud. Since retired by
   ADR 0007: the web app serves the root domain and the landing page.
3. **Done:** the schema is `prisma/schema/schema.prisma`. Four things followed
   it, as experiment 2 found:
   - the generator's `output`;
   - `prisma.config.ts`;
   - the drift script;
   - turbo's `db:generate` input.

   There are no closed models yet. Generate, deploy, `db:drift` and the
   suites that need Postgres pass against a real database.
4. **Done:** the closed documents are in `premium/docs/`, in the root's
   category layout and with their own index: positioning, the SaaS route,
   deployment, the ops agent briefing, the manage API, `ops/.env.example`,
   ADRs 0003 and 0004, and the legal pages. ADRs keep one numbering: the open
   index says a missing number lives with the closed edition.
   `docs/ops/analytics.md` stays open, because the open analytics code
   cites it and a shared test reads it.
   `premium/CLAUDE.md` took the operator console's conventions and the Railway
   deployment from the root `CLAUDE.md`. The root now names only what every
   instance needs, and mentions `premium/` in plain text, never as a link.
5. **Done:** `generate-icons.mjs` finds its targets from the apps under
   `apps/` and `premium/apps/`, so the open script names no premium path.
   Every app gets the same three exports, which gave the console an
   `apple-icon.png`.
6. **Done:** `lint:docs`, `lint:lang` and `assets:icons --check` cover
   `premium/`. The lint-docs change landed in seed first (shushuo/seed#10) and
   was copied verbatim:
   - a top-level directory with its own `docs/README.md` is linted as a second
     tree;
   - the legal pages are required only in a tree with a `pull-legal.mjs`.

   The language check exempts every app's `messages/`. The root documents link
   nothing under `premium/`; `premium/docs/README.md` and `premium/CLAUDE.md`
   link out to the root instead.

### Phase 3: the split

1. **Done: freeze `main`** (`99a4eb7`) and run the full gate. The tree outside
   the closed paths is the public edition.
2. **Done: scan that tree.** Gitleaks (v8.28.0) over the 167 tracked open
   files found no secret. A search for internal names, hosts and addresses
   found three kinds of finding, and the developer decided each on 2026-11-11:
   - **Internal tooling stays.** These are the `dev:shared` stack under
     `~/code/shushuo/dev`, sibling project names in comments, and seed's path
     in the verbatim Documentation section. None of it is sensitive.
   - **Hosted history leaves the root changelog.** Railway, the domains and
     the console's crash moved to `premium/CHANGELOG.md`, and the root keeps
     the open product's entries.
   - **Open files may mention `premium/` in plain text** (`premium/CLAUDE.md`,
     "The boundary"). The one script naming a premium package, `dev:manage`,
     is gone.
3. **Done: create the public repository.** `dsh-teamwork/dsh-teamwork-platform`
   holds the tree as one commit, "Initial community edition" (`49a2bb4`), on
   top of the commit GitHub made with the repository (an identical Apache
   `LICENSE` and a stub README). The commit was built from the tracked files
   themselves (`git archive` of `git ls-files` outside the closed paths),
   never by `git add -A`, which drops tracked files that `.gitignore` covers.
   It regenerated its own lockfile and passed the full gate on its own.
4. **Done: record it as merged in the closed repository**, with
   `git merge --allow-unrelated-histories -s ours upstream/main`. The
   boundary check is `premium/scripts/lint-edition.mjs`. It finds the last
   upstream commit merged into `HEAD`, and every open path must equal it,
   leaving out the closed paths and `pnpm-lock.yaml`. Measuring against the
   last merged commit, not upstream's tip, keeps the check green while a new
   upstream commit waits to be merged. The pre-push hook and CI run it
   wherever that script exists.
5. **Done: license the tree.**
   - `LICENSE` is Apache-2.0, at the root of both repositories, since it is
     an open file.
   - `NOTICE` holds the trademark sentence.
   - `premium/LICENSE` keeps the closed tree proprietary; a directory with
     its own `LICENSE` is covered by it.
   - The README asks for `Signed-off-by:` on every commit.
   - CI runs on pull requests too. Its `self-host` job builds
     `apps/web/Dockerfile`, starts `compose.yaml` from a bare `.env` and checks
     that the web app answers after its migrations. Experiment 3's
     browser-and-plugin script stays a manual check, because it needs the
     plugin's client and a browser.
6. **Make the plugin repository public**, relicensed Apache-2.0: a `LICENSE`
   file, and `"license": "Apache-2.0"` in its `package.json`.
7. **Hosted deploy unchanged.** Railway keeps deploying this repository.
   Redeploy once to confirm nothing moved.

### Phase 4: one command, nothing else to install

**Goal:** `npx @dsh-teamwork/server` on a machine with Node 24 starts a
working instance. Nothing else is installed or configured (ADR 0006).

**Non-goals:**

- a desktop app;
- several processes sharing one data directory;
- a tool that moves PGlite data to Postgres (a `pg_dump` is the documented
  path);
- providers shared across teams;
- revoking sessions when a password changes.

The steps, in order. Each lands on its own, through the public repository,
and keeps the gate green.

1. **Experiment, thrown away afterwards: can it be packaged?** Build the
   Next.js standalone output with PGlite and the migrations, pack it as an
   npm tarball, and run it with `npx` from a clean directory. It answers four
   questions:
   - whether Next.js bundles PGlite's WebAssembly, or needs it in
     `serverExternalPackages`;
   - how the migrations are applied without the Prisma CLI's schema engine
     in the package: through PGlite's socket server during start, or by
     replaying `migration.sql` files into `_prisma_migrations` directly;
   - the package size and the install time;
   - the time from command to first page.

   **This gates the rest.** If the package cannot be made reasonable (an
   install over about 150 MB, or a first page after more than about 30
   seconds), the decision goes back to the developer before any other step
   lands.
   **Done 2026-11-11, on Node 24.19: the package works, well inside the
   limits.**
   - **What went in.** A Next.js standalone build with PGlite bundled, the
     migrations, a launcher, and the traced dependencies shipped inside the
     tarball (`bundleDependencies`).
   - **Size.** 36 MB to download, 111 MB installed, no native binary, so one
     package serves every platform.
   - **Time.** From a clean cache to the first page took 14.8 s. Most of it
     was npx unpacking a local tarball; started directly, the server answers
     in 1.7 s. A published package should start much faster than 14.8 s,
     because npx reuses an unpacked version it already has. That was not
     measured: it needs a publish.
   - **Data.** A signed-in session created a user and a team; both survived a
     restart.
   - **Memory.** About 520–580 MiB.

   The step settled the open questions and showed what step 6 must do:
   - **Next.js bundles PGlite with no configuration.** Its WebAssembly, data
     file, `initdb` and the `pgcrypto` extension land in the server assets,
     though also, needlessly, in `static/media`.
   - **The launcher applies the migrations itself.** It replays each
     `migration.sql` into `_prisma_migrations` the way Prisma records it, in
     0.6 s with nothing to apply and 2.6 s for all four. The Prisma CLI is not
     shipped.
   - **Do not depend on `next` from the registry.** That installs 421 MB,
     including `@next/swc` compilers nothing runs. Ship the traced
     dependencies instead.
   - **Drop `sharp`.** It is the only native code, and only `next/image`
     optimisation uses it.
   - **Recreate Turbopack's external links.** Turbopack loads `pg` through a
     hashed alias in `.next/node_modules`, which `npm pack` drops. The
     launcher has to recreate it, or the build has to stop importing `pg`
     when it runs on PGlite.
2. **PGlite when `DATABASE_URL` is unset. Done 2026-11-11.**
   - `packages/db/src/pglite.ts` does three things:
     - opens PGlite in `PGLITE_DIR` on first connect, so `next build` creates
       nothing;
     - applies the migrations, recorded with Prisma's own checksums;
     - closes it on `$disconnect()`.
   - The database suites always run, on PGlite in memory, and CI runs them
     on Postgres too.
   - Both packages are pinned to exact versions.
   - **What the build taught step 6:**
     - **Bundled, PGlite cannot initialise a new directory**: Turbopack breaks
       its `initdb`'s `instantiateWasm`. So `apps/web` loads it unbundled
       (`serverExternalPackages`), as it does `pg`. The package then ships
       PGlite and the adapter as hashed external links in `.next/node_modules`,
       beside `pg`'s.
     - **The migrations path compiles to the repository-relative
       `packages/db/src/pglite.ts`**, so the package keeps
       `packages/db/prisma/migrations` at that path.
3. **Passwords when `SMTP_URL` is unset. Done 2026-11-11.**
   - The hashes are scrypt with their parameters, in an open `passwords`
     table. The code is `@dsh-teamwork/shared/server/passwords`, apart from
     the NextAuth entry so a test can load it without `next-auth`.
   - Ten guesses per account per fifteen minutes. Each is spent before the
     comparison, in two conditional updates rather than a lock.
   - `/setup?token=…`, printed by `src/instrumentation.ts` at start, claims
     the first account:
     - the token is derived from `AUTH_SECRET`, so nothing stores it;
     - it is dead once any password exists, and two racing claims get one
       account between them.
   - In `/team`, an admin creates a member with a generated first password
     and resets it. `/team`, `/plugin` and the plugin's code stay closed to
     its owner until they change it at `/password`.
   - Invite links remain the flow when email is configured.
   - The development fallback that printed a code without SMTP is gone:
     without SMTP the door is a password.
4. **Providers per team. Done 2026-11-11.**
   - An open `team_providers` table holds each provider's name, base URL and
     key, sealed with AES-256-GCM under `PROVIDER_KEYS_SECRET` and bound to
     the team and the name (`src/lib/provider-keys.ts`).
   - `/team` adds, moves, re-keys and removes providers; a key is write-only,
     the name is fixed, and a provider a team model calls cannot be removed.
     A team model must name a provider the team has.
   - The gateway resolves routes from the caller's team.
   - `src/lib/provider-network.ts` holds the address rule:
     - public https, unless `ALLOW_PRIVATE_PROVIDERS=true` also admits
       loopback and private networks;
     - plain http only to those;
     - link-local, carrier-grade NAT and unspecified addresses count as
       private.
   - The rule runs on save, before each call, and inside the connection's
     lookup. An undici `Agent` carries the guarded lookup (`undici` 7.30.1,
     exact), so the socket opens only to addresses that passed. The plan
     wrote "connects to the address it checked"; checking the socket's own
     answer gives the same guarantee and keeps TLS name checks intact.
   - `compose.yaml` sets `ALLOW_PRIVATE_PROVIDERS=true`.
   - `LLM_ROUTES_JSON` and its key variables are gone.
5. **The plugin accepts `http://` to private addresses** with a warning
   (`../dsh-teamwork`, `src/client.ts`). It ships with its own release.
6. **The `npx` package.**
   - `@dsh-teamwork/server` has a `bin` that:
     - creates the data directory (`~/.dsh-teamwork`, or `--data`);
     - writes `AUTH_SECRET` and `PROVIDER_KEYS_SECRET` there on first start,
       readable only by the user;
     - applies the migrations, prints the setup link, and serves.
   - The address is loopback by default; `--host` opens it to the network.
   - CI publishes it on a release tag.
7. **The README, `CLAUDE.md` and `.env.example` describe both paths:**
   - `npx` for a first team;
   - `compose.yaml` with Postgres and SMTP when it grows.

**Open question, for the developer:** whether `--host` defaults to loopback.
The plan says yes: a first run then exposes nothing, and a team adds one flag.
The npm package is scoped because `dsh-teamwork` on npm is someone else's; the
`dsh-teamwork` organisation on npm is ours.

**How done is verified:**

- A CI job on a clean runner does the whole run with only Node and a stub
  provider:
  1. `npx` the packed tarball;
  2. claim the first account with the printed link;
  3. create a member and change their password;
  4. add the stub provider;
  5. sign the plugin in and sync;
  6. get one answer through the gateway;
  7. stop the server, start it again, and find the team still there.
- Every database suite passes on both PGlite and Postgres.
- Tests pin the boundaries:
  - a password guess beyond the limit is refused, even under a concurrent
    burst;
  - a provider key never appears in a response;
  - a private provider address is refused without
    `ALLOW_PRIVATE_PROVIDERS`;
  - the plugin refuses `http://` to a public address.
- On `dshteamwork.com`, sign-in is still the emailed code and Google,
  and a team calls models with its own provider key.

### Phase 5: the first release

This phase is gated on the plugin's wire having settled, and on Phase 4.

- Tag `v0.1.0` in the public repository, write its first `CHANGELOG.md`
  entry and publish a GitHub release.
- The developer moves the public repository's stage line to Maintaining, and
  this repository's line for the open surface with it (ADR 0005).

## How the two stay in step

- **Open work happens in the public repository.** A pull request there runs
  the full gate in CI, so outside contributions get it too. It merges to
  `main`, and a release is a `v0.x.y` tag with its `CHANGELOG.md` entry.
- **This repository takes it with `git merge upstream/main`** and then
  `pnpm install`, which regenerates the lockfile. The gate then runs,
  `lint:edition` included. The merge commit names the upstream tag or commit.
  A conflict outside the lockfile means an open file was edited here; the fix
  is to move that edit upstream.
- **A closed feature never edits an open file.** It may need open code to call
  it: a sign-in provider, an authorization check or an audit sink. That
  extension point is added upstream first, as an open change with a working
  open default, in the same piece of work as the closed feature that fills it.
- **The plugin.** It states the oldest server version it works with. Once the
  open surface is maintained, the server's wire only grows, so a newer server
  never breaks an older plugin.

## Open questions

None remain. The developer settled these on 2026-11-10:

1. **The hosted home page** was a closed `premium/apps/site` on the root
   domain; ADR 0007 has since made it the open web app's `/` (see "The hosted
   home page").
2. **Public documents:** the architecture, the design system and ADRs 0001,
   0002 and 0005. The rest stays here: positioning, the SaaS route, ops,
   legal, and ADRs 0003 and 0004, which are about the business. The public
   ADR index says why its series has gaps.
3. **The plugin is relicensed Apache-2.0**, like the rest of the edition. Its
   `package.json` says MIT today.
4. **This repository is `dsh-teamwork/dsh-teamwork-premium`**, renamed from
   `platform` on 2026-11-10 because it holds
   both the cloud service and the enterprise edition. The closed paths are
   named after it: `premium/`, `(premium)`, `premium-*.prisma` and
   `*_premium_*`.
5. **The gateway may call a provider over plain HTTP only on loopback and
   private networks** (raised by experiment 3). A self-hosted team can then
   use a model it serves itself (Ollama, vLLM). A public host still needs
   `https://`. ADR 0006 has since moved the address to each team's admin, and
   with it the rule behind `ALLOW_PRIVATE_PROVIDERS` (Phase 4 step 4).

## How done is verified

- **Experiment 3's run, scripted, passes in the public repository's CI** on
  a clean runner with only `compose.yaml`. That covers sign-in over SMTP, a
  team, an invite, a published model, plugin login and sync, and one gateway
  answer from a stub provider.
- **`pnpm lint:edition` passes here**, and fails when an open file is edited
  deliberately.
- **The secret scan of the public tree is clean**, and the public repository's
  history is the one initial commit.
- **The hosted service is unchanged.** On `dshteamwork.com`, signing in
  by email over the new transport still reaches `/team`. The console still
  admits only `ADMIN_EMAILS`. The home page links `/privacy` and `/terms`.
- **This document is rewritten as `Current`.** It then describes the two
  repositories and the merge workflow, and stays public, as the
  developer decided.
