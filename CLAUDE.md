# DSH Teamwork

The team and company edition of DeepSeek Harness (DSH). **What ships today is
team configuration**: a team admin publishes models, presets and plugin pins
once; every member's DSH pulls them through the `@dsh-teamwork/dsh-teamwork`
plugin (its own repository, `../dsh-teamwork`) and calls team models through
this server, so provider keys never leave it. **The direction is wider**
(ADR 0003): governed first, so a company can hand over code and conversations
(SSO, roles, audit, sandboxes); then team assets, so sessions and memory stay
with the team; then chat bots, starting with Lark, as the everyday entry. It
is built first as one hosted, multi-tenant service (ADR 0004), and is open
core: what one team needs becomes a self-hosted, open-source community edition,
and what a company needs stays closed (ADR 0005).
`premium/docs/prd/positioning.md` has the order, the smallest next version and
the open questions; `premium/docs/tech/saas-route.md` is the plan for building
it.

## Stage: Building

**This repository is in the Building stage.** Nothing has shipped, so nothing
depends on it yet; the maintained edge is the migration history, which is
append-only from the first row somebody else wrote.

A system is in exactly one of three stages, and the stage decides which
trade-offs are correct — the same diff can be right in one and wrong in the
next. It is stated here, near the top, because an agent that is not told the
stage will infer one, and it infers wrong in both directions: compatibility
shims around a design nobody depends on yet, or a free-hand rewrite of something
people already do.
**Moving between stages is the developer's decision and a deliberate edit to the
line above**, never something a task concludes on its own.

### Planning — the deliverable is a decision, not a diff

Nothing lands. Writing code early feels like progress and is the most expensive
way to discover the wrong thing was being built, so the work is thinking, and it
is done when these are answered and written down:

- **Positioning** — what this is, who it is for, and what it is *instead of*. A
  feature list with no positioning above it is a wish list.
- **Non-goals** — what it deliberately will not do. The unwritten non-goal is
  the one that comes back later as scope creep with a plausible story.
- **The smallest useful version** — the least a real user could get real value
  from, and what it leaves out. If that version is not obviously valuable, the
  problem is the positioning, not the scope.
- **The technical route** — the shape of the system, what it costs to run, and
  which parts are expensive to change afterwards (a storage or wire format, a
  key hierarchy, a public API, anything a user's own data lands in) as against
  the parts that are cheap to change any time.
- **The order of work** — what gates what, and which unknown would invalidate
  the rest if it resolved badly. Settle those first with the smallest experiment
  that answers them — a spike, a measurement, a prototype against real input —
  and then throw that code away rather than landing it.
- **The question that must not be guessed** — where two readings of the request
  lead to two different systems, ask the developer instead of quietly picking a
  default and building on it.

The plan is an edit to where this repository already keeps its plans, not a new
document beside them.

### Building — the shape is not settled, so break it freely

Being wrong here costs one rewrite. Being compatible too early costs the wrong
shape, permanently.

- **Compatibility is not a constraint yet.** Change a request or response shape,
  rename a column, drop a field, delete a table, move a route. Do **not** version
  an endpoint, add an optional field beside the one it supersedes, or write a
  shim for a caller that does not exist.
- **Data is expendable; the tooling that rebuilds it is not.** Wiping a local
  database is free. The migration history, the schema and the seed are how the
  thing gets rebuilt at all, so a schema change still goes through this
  repository's documented migration path even when nobody would mourn the rows.
- **Build vertical slices, not layers.** One path working end to end teaches more
  than three horizontal layers that have never met. A layer with no caller is a
  guess with a build step.
- **Replace a wrong design; never wrap it.** A flag beside the old path buys a
  day and costs the deletion forever.
- **Test the decisions, not the scaffolding.** Pin what would be expensive to get
  wrong silently — money, keys, merges, formats, ordering, security boundaries —
  and leave code that is about to be rewritten uncovered on purpose.
- **Building is licence to change the design, not to land a red branch.** The
  gate this repository defines still runs before every push.

### Maintaining — somebody depends on this, including the copy you cannot reach

- **Compatibility is the first constraint**, ahead of elegance and ahead of a
  smaller diff. Assume a record already written, a file already encrypted, a
  client already installed, a key already minted, a link already shared. Changes
  are additive, readers stay tolerant of what older writers produced, and a
  migration runs forwards over data that already exists.
- **A break is fine when the developer asks for one**, and only then. It is a
  decision rather than an accident: one deliberate change that says what breaks,
  who is affected and how they get across, written in the same commit. Never the
  side effect of a refactor.
- **Quantify a technical strategy end to end.** The justification is a number
  from a test that drives the real path — the API a client calls, the job as it
  runs, the screen as it renders — over the same input before and after: latency,
  failure rate, cost per run, accuracy against a fixed corpus. Prefer one
  end-to-end simulation to a page of unit assertions: units say the parts still
  behave, only the whole path says the user is better off. "It should be faster"
  is not a reason; the same fixture, run twice, is.
- **Every fix starts with a reproduction.** The failing test first, then the fix,
  so the bug cannot come back unnoticed.
- **Price risk by blast radius, not by diff size.** Three lines in a migration,
  an auth guard, a crypto parameter or a billing path is a big change; a hundred
  lines inside one screen is a small one. The big one ships on its own, with the
  rollback known before the push.
- **A refactor needs a reason a user would recognise** — a bug it prevents, a
  measurement it moves, a change it unblocks. Tidiness alone was reason enough in
  Building; here it is not.

### When one repository holds parts in different stages

Then the stage belongs to the surface being touched, the line at the top is the
default, and every exception is written down where that surface is described
rather than carried in somebody's head. **If a change crosses into a maintained
surface, the maintained rules win**, whichever side the work started on.

No stage relaxes the rest of this file: the smallest change that works, the
language rule and the gate hold throughout. So does the floor — losing a user's
data, leaking a secret and swallowing an error are wrong in every stage.

## The smallest change that works

**The goal is a repository that stays easy to read, to change and to trust. The
means is keeping it small.** Every file, concept, indirection and document is
something a future reader — usually you, months later — has to load before they
can change anything safely, and that cost is paid again on every task that
follows. So the default is the smallest set of features and the least code that
satisfies the request, in planning and in implementation alike: a plan proposes
the smallest version that is actually useful, and the diff that follows is the
smallest one that makes it true. A large refactor is something the developer
asks for explicitly — never something a task grows into on its own.

- **Extend before you add.** A new file, module, package, app, script, table,
  column, environment variable or dependency has to earn itself against the
  option of putting the change where the code already is.
- **Build what was asked, not what might be asked.** No config switch, optional
  parameter, abstraction layer or generalisation that has exactly one caller
  today. A seam for a second implementation that does not exist yet is dead
  code with a plausible story.
- **Replace, do not accumulate.** When behaviour changes, change it — do not
  leave the old path beside the new one behind a flag, and do not add a
  parallel field next to the one it supersedes. The parallel version is the one
  nobody ever deletes.
- **Deleting is part of the change.** Code, docs and tests the change made
  unreachable go in the same commit. A diff that only adds lines is a claim
  that nothing was superseded; make sure that claim is true.
- **Documentation is under the same rule.** Prefer an edit to an existing doc
  over a new one; never write a document that restates a document that exists;
  never leave a plan, summary, migration note or status report behind as a
  by-product of doing the work — working notes belong in the conversation, not
  in the repository. When a change makes a doc wrong, the fix is editing that
  doc, not adding one that disagrees with it.

**Small is the means, so where the two come apart the goal wins.** Packing
unrelated things into one file, cryptic names, skipping tests, skipping the doc
and header updates this repo's own conventions require, dropping error
handling, or leaving a known bug because the fix would be a bigger diff — each
of those buys a smaller diff and a worse repository, which is the opposite
trade. The quantity being minimised is what a reader has to understand, not the
character count.

**When the smallest version is genuinely the wrong answer**, say so before
writing it: name the larger option, what it costs in new files and concepts,
and what breaks without it, then let the developer choose. Raise it as a
question, not as a fait accompli in the diff.

**Less is more, and it governs the product, not only the diff.** Everything
above is about the size of a change; the same judgement decides what gets built
at all. A feature is not worth having because somebody could want it, and an
abstraction is not worth having because it would be elegant — each is worth only
what it returns against what everyone who comes after has to carry. So plan for
the smallest set of features that delivers the most value, and build that set
without a layer, a wrapper or a configuration surface the product does not need
today. Over-design in the architecture is feature creep one floor down: the same
mistake, made in code instead of in scope.

**This is an argument for ambition, not for timidity.** The reason to refuse the
average adjacent feature is that it spends the attention the core needs. What
makes this product worth using is one thing done better than anyone else does
it, and getting there takes thinking, prototyping and the freedom to try
something that may not work. Be bold there — take the real risk on the core, and
take it early — and be ruthless about everything around it, because every
mediocre peripheral feature is paid for out of the same budget.

Nothing enforces this automatically; the check is review.

## Language

**Everything a developer reads is English.** Code, identifiers, comments — file
headers included — documentation, README files, test names, commit messages and
PR text. **Everything a user reads is whatever language they picked**, and lives
in data files. `pnpm lint:lang` (`scripts/check-language.mjs`) enforces the line
in the gate: it scans every tracked file for CJK and fails outside this list —
if the table and the script disagree, the script is right.

| Exempt | Why it is not source |
| --- | --- |
| `apps/*/src/messages/*.json`, `premium/apps/*/src/messages/*.json` | The product ships in `en` and `zh-CN` (`LOCALES` in `@dsh-teamwork/shared`). |
| `packages/shared/src/locales.ts` | Endonyms: a language picker names each language in itself. |

Exemption covers the **data**, never the file: keys, comments and test names are
English. A new entry goes into `ALLOWED` in the script **with a `why`**; an
unexplained entry is how the rule quietly dies.

### The repo is English; the conversation is Chinese

**Reply to the developer in Chinese.** In a Claude Code session the default
language is Chinese: explanations, plans, questions, the reasoning behind a
diff, the report at the end of a task.

This loosens nothing above, because the rule already turns on **who reads it**.
A chat reply is read by one person, in the language they read fastest. A commit
message, a PR title or body, a comment, a doc, a test name and every identifier
are read by whoever opens the repository next — so those stay English even when
the Chinese sentence introducing them in chat does not. Quoting them verbatim
inside a Chinese reply is the normal shape of an answer here, not an exception
to it.

The developer's own message decides: one written in English, or an explicit ask
for English, switches the reply for as long as that holds.

## Commands

```bash
pnpm dev:setup        # this project's own Postgres 16 via dev/docker-compose.yaml
pnpm dev:stop | dev:clean    # stop it; clean also drops its volume
pnpm dev:shared       # or: the shared ~/code/shushuo/dev stack (SHUSHUO_DEV overrides)
pnpm dev:shared:status | dev:shared:stop
pnpm dev              # every app; web :3800
pnpm dev:web

pnpm tsc              # the gate, in CI's order: tsc → lint:lang → lint:docs →
pnpm lint:lang        #   assets:icons --check → lint → db:drift → test → build.
pnpm lint:docs        #   The husky pre-push hook runs all eight before every push,
                      #   plus, where premium/ exists, the edition boundary.
pnpm assets:icons --check
pnpm lint
pnpm db:drift
pnpm test
pnpm build

pnpm db:generate      # regenerate the Prisma client (postinstall does this)
pnpm db:migrate       # AUTHOR a migration — local database only
pnpm db:deploy        # APPLY committed migrations to a deployed database
pnpm db:push | db:reset | db:studio | db:seed

pnpm assets:icons     # every icon and logo, raster and vector, from docs/brand/icon.svg
```

**Two local stacks, one set of `.env` values.** `pnpm dev:setup` runs this
project's own Postgres (`dev/`, compose project `dsh-teamwork-dev`); `pnpm
dev:shared` runs the `~/code/shushuo/dev` stack every sibling can share, where
this project is registered (`registry.conf`: database `dsh_teamwork`, shadow
`dsh_teamwork_shadow`; `ports.conf`: 3800/3801). Both create the same databases
with the same credentials, so `cp apps/web/.env.example apps/web/.env` (and
`premium/apps/manage`, `packages/db`) reaches either unedited, apart from
`AUTH_SECRET`. Both bind 5432, so only one runs at a time; `dev:setup` refuses
while another stack holds the port. Each keeps its own data: switching stacks
means `pnpm db:deploy` again. There is no object store, because nothing here
stores files.
With no `SMTP_URL`, sign-in is an email and a password, and the web app prints
a link that claims the first account when it starts.

**CI runs on a push to `main`** — a merge — **and on every pull request**, plus
by hand from the Actions tab: the gate above, and a `self-host` job that builds
`apps/web/Dockerfile` and starts `compose.yaml`. `.husky/pre-push` runs the gate
before a branch leaves your machine. `git push
--no-verify` is for a work-in-progress branch nobody will merge yet, not for
landing a red `main`. The `@claude` workflow (`.github/workflows/claude.yml`)
needs a `CLAUDE_CODE_OAUTH_TOKEN` repository secret (`claude setup-token`);
without it that workflow fails and nothing else is affected. Suites that need a
database run on PGlite in memory without `DATABASE_URL` and on Postgres with it;
CI runs them both ways. `db:drift` skips without `SHADOW_DATABASE_URL` (see
`packages/db/.env.example`); CI provides it, so skipped locally never means
skipped everywhere.

**Every vitest workspace names its own `include` and excludes `dist`** (Vitest 4
dropped `**/dist/**` from its default exclude). Next.js apps default to the
`node` environment; a suite that needs the DOM opts in with
`// @vitest-environment jsdom` on its first line. Types are checked once, by
`pnpm tsc`, including the test files.

### Prisma: where it lives, and how it finds the database

`packages/db` (`@dsh-teamwork/db`) is the single owner of the schema. **`db:migrate`
authors, `db:deploy` applies**: `prisma migrate dev` diffs, writes, needs a
shadow database and offers to reset the one it is pointed at, so
`packages/db/scripts/assert-local-database.mjs` refuses it — and `db:push` / `db:reset` — on
any non-local host (`ALLOW_REMOTE_MIGRATE_DEV=1` is the deliberate escape hatch).
`db:drift` replays every migration into a scratch database and compares the
result to the schema (`prisma/schema/`), so a column that reached a database only through
`db:push` cannot land unnoticed.

**With no `DATABASE_URL` the apps run on PGlite** (ADR 0006): Postgres compiled
to WebAssembly, inside the process, in `PGLITE_DIR` (default
`~/.dsh-teamwork/db`; `memory://` for a throwaway). `packages/db/src/pglite.ts`
opens it on first connect, applies the committed migrations there — recorded in
`_prisma_migrations` exactly as `prisma migrate deploy` records them — and
closes it on `$disconnect()`. One process owns a data directory. The Prisma CLI
cannot reach it, so `db:migrate`, `db:drift` and `db:studio` need Postgres.

For those commands `DATABASE_URL` is resolved in one place,
`packages/db/prisma.config.ts`: a real environment variable first, then the
first of `packages/db/.env`, the root `.env`, `apps/web/.env`; with nothing
set, the `pnpm dev:setup` stack. The guard reads the same list in the same
order.

Every `prisma` / `@prisma/*` dependency is pinned to an **exact** `7.9.1` (as is
`vitest` at `4.1.11`): what a caret resolves to is decided by the day the
lockfile was written. The client is generated into `packages/db/src/generated`
(gitignored, turbo-cacheable); import `PrismaClient`, `Prisma` and model types
from `@dsh-teamwork/db`, never from `@prisma/client`. Primary keys are `nanoid()`,
generated in Postgres by the first migration. `@electric-sql/pglite` and
`pglite-prisma-adapter` are exact too, and `apps/web` loads both unbundled
(`serverExternalPackages`): bundled, PGlite cannot initialise a new directory.

## Architecture

```
apps/web             Next.js 16 — the site, the team console (/team), the
                     plugin's sign-in page (/plugin) and the API the plugin
                     calls (/api/*)
packages/db          Prisma schema, migrations, ensureUser
packages/shared      what the clients agree about (root: isomorphic, including
                     the team wire schemas) and the server-only sign-in
                     strategy (@dsh-teamwork/shared/server/*)
premium/apps/manage  Next.js 16 — the operator console; /api/admin/* for
                     automation
premium/apps/site    Next.js 16 — the hosted landing page, /privacy and /terms
                     on the root domain; no accounts, no database

Everything under premium/ is closed and stays out of the community edition
(docs/tech/community-edition.md). Before changing anything there, read
premium/CLAUDE.md.
```

**The one rule about data access:** clients call the web API, and Prisma is
reached only from the Next.js apps, where the ownership checks live. A request
or response that crosses the wire has its Zod schema in `@dsh-teamwork/shared`,
and both ends parse with it. The plugin repository cannot import that package,
so `../dsh-teamwork/src/client.ts` restates the snapshot shape; a change to
`packages/shared/src/team.ts` that touches the wire changes it in the same
working session.

### Teams and the model gateway

`apps/web/src/lib/team.ts` holds every team rule; the `/api/team*` routes and
the `/team` page both call it. Each function re-reads the caller's membership
and acts on the team *that* row names, so a removed member is refused on the
next request and an admin check can never pair with another team's id. One
person is in at most one team (`Membership.userId` is the key). A failure is a
`TeamError` with a `TEAM_ERRORS` code, worded in `teamErrors.*` in the messages.

`apps/web/src/lib/llm-gateway.ts` is the model gateway
(`POST /api/llm/chat/completions`, OpenAI Chat Completions). The wire `model`
is a team configuration id; the server resolves it within the caller's team,
picks the provider from `LLM_ROUTES_JSON` (https, or plain http only to a
host that resolves to loopback or private addresses) and its key from the
variable that names, forwards an allow-list of inference fields and none of the
upstream headers. Nothing a caller sends can name a URL, a header or a key.

### Sign-in

NextAuth (Auth.js v5, JWT sessions, no adapter): Google, and one email door
decided by `SMTP_URL` (ADR 0006):

- **With it**, a code emailed over SMTP — the hosted service uses Resend's
  endpoint — and stored as an HMAC under `AUTH_SECRET` (ten minutes, at most
  five checks — each spent before the comparison — and five per address per
  fifteen minutes, counted under an advisory lock). People join a team by
  single-use invitation.
- **Without it**, a password, stored as scrypt with its parameters
  (`@dsh-teamwork/shared/server/passwords`, the `passwords` table). Ten wrong
  guesses per account per fifteen minutes, each spent before the comparison. A
  team admin creates a member's account with a first password, shown once,
  which its owner must change before `/team` or `/plugin` open; the admin
  resets it the same way. The first account is claimed at
  `/setup?token=…`, a link the server prints at start, derived from
  `AUTH_SECRET` and dead once any password exists.

Verifying a request ends in an `Identity` (`@dsh-teamwork/shared`), whose `via`
names the door; `User.authId` is the lower-cased email, so every door for one
address is one account. An app built with `emailCodes: false` — the console —
admits only Google sessions.

**The DSH plugin signs in through the website** (`docs/adr/0001-plugin-sign-in.md`).
`/teamwork login` in DSH prints `/plugin?challenge=…`; the signed-in person
confirms, and is shown a two-minute code bound to that PKCE challenge, which
they paste back (`/teamwork authorize <code>`). The plugin trades code + verifier at
`POST /api/auth/plugin/token` for a 30-day Bearer token
(`packages/shared/src/server/auth/nextauth/{plugin,tokens}.ts`). A JWT session
or token **cannot be revoked before it expires** — the price of having no
session table, chosen deliberately; team access is still re-checked on every
request.

| Where | What |
| --- | --- |
| `@dsh-teamwork/shared` | `Identity`, `bearerFromHeader`, `returnPath`, `PLUGIN_CHALLENGE`, the admin allowlist, the email/code schemas and `AuthError` codes |
| `@dsh-teamwork/shared/server/nextauth` | `createNextAuth`: `identity()`, `refreshSession()`, the four actions, `plugin.mint` / `plugin.redeem` |
| `@dsh-teamwork/db`, `@dsh-teamwork/shared/server` | `ensureUser`, `createUserResolver` → `currentUser` / `requireUser` (the web app's; the console stops at the `Identity`) |
| Each app's `lib/auth/` | Its options (`nextauth.ts`), `strategy.ts`, the actions; the mounts `/api/auth/[...nextauth]` and, in web, `/api/auth/plugin/token` |

Each app's cookies are its own (`dsh-teamwork-web-auth*`, `dsh-teamwork-manage-auth*`): on
localhost the apps share a host, since cookies ignore the port.

### Locale

`en` and `zh-CN`, and **never in the URL**. Web: the profile's `locale`, then the
`locale` cookie, then `Accept-Language` (`src/lib/locale.ts`, next-intl without
routing), resolved through `matchLocale` in `@dsh-teamwork/shared`; a signed-in
choice is written to the profile.

### Analytics

One PostHog project per product, fed from two sides
([`docs/ops/analytics.md`](docs/ops/analytics.md)):

- **The browser counts anonymously.** `apps/web/src/components/analytics.tsx`
  runs in cookieless mode with no identity: pageviews only, no autocapture, no
  recording, and no consent banner.
- **The server reports what happened to an account.** `captureServerEvent`
  (`@dsh-teamwork/shared/server`) sends under `User.id`. It fires where the server sees
  the event: a sign-up in `createUserResolver`, a profile change in its route.
- **One table of events.** Every name and its strict property schema is
  `ANALYTICS_EVENTS` in `@dsh-teamwork/shared`. A test holds `docs/ops/analytics.md` to
  it, and no property carries anything a person typed.
- **The database is the authority for outcomes**; PostHog is for funnels and
  traffic. `premium/apps/manage` sends nothing.

### Search and sharing

What a crawler or a link preview reads, in `apps/web` (an instance's own
`robots.txt`, `sitemap.xml` and canonicals) and `premium/apps/site` (the hosted
service's public pages, which keep the same rules and add the share card):

- **`APP_URL` is the site's address** (`src/lib/site.ts`): `metadataBase`, `robots.txt`
  and `sitemap.xml` name it, and never the Host header, which a stranger can set.
  Set it in every deployment.
- **A public page states its own `alternates.canonical`**; signed-in and sign-in
  screens carry `robots: { index: false }`, and `src/app/sitemap.ts` lists only the
  public pages. `src/app/__tests__/seo.test.ts` holds the three files together.
- **The share card is the site's `opengraph-image.tsx`**, English on purpose (its Onest files
  carry no CJK glyphs); it draws the exported `public/logo.svg`, so it follows
  `docs/brand/icon.svg` without being edited. The site's landing page carries
  `Organization` and `WebSite` JSON-LD. The locale is never in the URL, so there is
  no hreflang.
- **AI crawlers** (`src/lib/ai-crawlers.ts`, the same file in every sibling):
  crawlers that gather training data are refused in `robots.txt`; search and
  assistant fetchers are deliberately not named, so they follow the `*` group and
  can cite the site. A product whose pages are written for agents passes those
  paths to `aiTrainingRule()`. To allow training, empty `AI_TRAINING_BOTS`.

## Deployment

A self-hosted instance runs `compose.yaml` (`README.md`, "Self-hosting"):
Postgres and `apps/web/Dockerfile`, which applies the migrations and then
serves. Each app's `dev` pins its port; **`start` never does**, so the host's
`PORT` decides — a pinned `start` port is how two siblings served 502s. The
hosted service's deployment is in `premium/CLAUDE.md`, where that directory
exists.

## Documentation

**Every repository lays out `docs/` the same way, so a document found in one is
found in all of them.** This section is kept verbatim across the siblings, with
seed as its source; what a repository adds for itself goes under "In this
repository" at the end, and nowhere else.

### Where a document goes

`docs/README.md` is the index and `docs/design.md` is the visual system. Every
other document sits in exactly one category, named by the question it answers:

| Directory | Answers | Well-known files |
| --- | --- | --- |
| `docs/prd/` | What is built, for whom, and why | `positioning.md`, `business-model.md` |
| `docs/tech/` | How it is built | `architecture.md`, `data-model.md` |
| `docs/adr/` | Which decision was taken, and what it cost | `NNNN-kebab-title.md` |
| `docs/ops/` | How the production system is operated and shipped | `ops-agent-briefing.md`, `manage-api.md`, `analytics.md`, `app-submission.md`, `.env.example`, `email-templates/` |
| `docs/legal/` | What the product publishes to its users verbatim | `privacy.md`, `terms.md` |
| `docs/brand/` | What the brand artwork is drawn from | `icon.svg` |

- **A well-known file has that name and no other.** The technical architecture
  is `docs/tech/architecture.md` in every repository — never
  `technical-architecture.md`, never an overview at the root of `docs/`.
- **The visual system is one file, `docs/design.md`**: the brand mark, colour,
  type, spacing, iconography and the rules components follow. There is no
  `docs/design/` directory — no screen-by-screen specs, UX walk-throughs,
  prototypes or design-tool files. A screen is specified by its code, and a
  token by the stylesheet that defines it.
- **`docs/brand/` holds source artwork, never prose, and each file is the only
  hand-edited copy.** `icon.svg` — the mark on its plate — is the source of
  every icon and logo the product ships, raster or vector: `pnpm assets:icons`
  writes them all, and an exported file is overwritten rather than edited. A
  copy that has to live inside code (a component drawing the mark inline) is
  not written but checked: `pnpm assets:icons --check` fails when it no longer
  matches the source.
  What the artwork means and how it may be used is `docs/design.md`; a second
  source file here (a lockup, a wordmark) is added only when it cannot be
  derived from `icon.svg`, and `design.md` says why.
- A category may hold subdirectories by topic (`docs/ops/email-templates/`). A
  repository holding two products gives each a subdirectory inside the category
  (`docs/prd/lifetalk/`); what serves both stays at the category root.
- **Nothing else sits at the top of `docs/`**: no other directory, and no file
  but the index and `design.md`. A new category is a change to this section,
  made in seed first.
- **A second edition kept beside the first gets a tree of its own**, for
  example a closed edition beside an open one that is published without it.
  The tree is a top-level directory holding its own `docs/` (with its own
  `README.md` index), `README.md`, `CLAUDE.md` and `CHANGELOG.md`, laid out
  and linted exactly like the root's. Only the root keeps `docs/design.md`: a
  product has one visual system.
- **Running it locally is not a document.** The commands, ports, services and
  environment a developer needs live in `CLAUDE.md`, where every session reads
  them; what only production needs — deploys, store submission, console
  setup, credentials for an operator — is `docs/ops/`.
- **A third-party service is reached through its own MCP server or connector,
  never through a key in `docs/ops/`.** PostHog, Railway and Resend each
  publish one; whoever runs the agent installs it and signs in, so
  `docs/ops/.env.example` holds only what this repository issues itself, such
  as `MANAGE_API_KEY`.
- The repository root holds `README.md`, `CLAUDE.md`, `AGENTS.md` and
  `CHANGELOG.md`, and no other prose. A plan, a TODO list or a design note at
  the root is a document in the wrong place.
- A README beside code (`packages/x/README.md`, `assets/README.md`) documents
  that directory and stays beside it. An image sits beside the document that
  uses it.

### Naming

- Lowercase kebab-case, `.md`, English: `data-model.md`,
  `mobile-cache-strategy.md`. `README.md` is the one uppercase name in `docs/`.
- **No date, version or status in a name.** `prd-v1.md`,
  `2026-04-15-sync-design.md` and `final-plan.md` each record something that
  changes, in the one place that cannot change without breaking every link to
  it. The date is git's, and the status is the header's.
- The one exception is an ADR's `NNNN-` prefix, which orders the series.

### Header, status and version

Every document opens with its title, one status line, and one sentence saying
which question it answers:

```md
# Data model

> **Status:** Current · **Updated:** 2026-09-28

Every table, what owns it, and which invariants the schema enforces.
```

- **Status** is one of `Draft` (being written; questions open), `Plan`
  (decided, not built), `Current` (describes what exists, and is kept true),
  `Superseded by [x](x.md)`, or `Archived` (kept as a record; describes nothing
  current). One short clause may follow after a dash: `Plan — phases 1–3
  shipped`.
- **Updated** is the date of the last change of substance. A typo fix does not
  move it; changing a claim does.
- **Git is the version history.** No `Version: x.y` line, no revision-history
  table and no changelog section inside a document, `CLAUDE.md` included — each
  is a second history that drifts from the first. `CHANGELOG.md` is the one
  history kept outside git, and it records the system, not the docs (below).
- An ADR's line is `> **Status:** Accepted · **Date:** YYYY-MM-DD`, with
  `Proposed`, `Accepted` or `Superseded by NNNN`. Once accepted, only its status
  changes; a changed mind is a new ADR.
- **`docs/legal/` is the one source of the published legal pages.** Its
  `privacy.md` and `terms.md` are English, carry their own dated line
  (`_Last updated: September 28, 2026_`) instead of the status header, and are
  rendered into the web app's `/privacy` and `/terms` at build; no page restates
  them. They are required in the tree whose app publishes them (its
  `pull-legal.mjs`), and nowhere else. An index README carries no header.

### What a document contains

Every document puts its conclusion first: a reader who stops after the first
paragraph has the answer, and the reasoning follows. One file answers one
question. A term is defined in one place and linked from everywhere else.

| Document | Must contain |
| --- | --- |
| `design.md` | The brand mark and its rules; every colour token in light and dark; the type scale; spacing and radius; the icon set; component rules; and the file in code that owns each token |
| `prd/positioning.md` | What it is, who it is for, what it is *instead of*; non-goals; the smallest useful version |
| `tech/architecture.md` | The components and what each owns, where each lives in the tree, the data flow, external services, deployment, and what is expensive to change |
| An ADR | Context, Decision, Consequences — including what it costs and what it rules out |
| A plan (`Status: Plan`) | The goal, non-goals, the order of work and what gates what, open questions, how done is verified |
| An ops runbook | When to use it, the steps, how to tell it worked, how to roll back |

### The index

`docs/README.md` lists every document, grouped by the categories above, **one
line each**: a link and at most fifteen words saying which question it answers.
It opens with what to read first. A subdirectory may keep its own README as the
index of a series (the ADRs, one product's documents); `docs/README.md`
then links to that README instead of repeating it.

Nothing else is an index. The root `README.md` links to `docs/README.md`, and
`CLAUDE.md` names only the documents an agent must read before a particular
kind of change. Both link; neither lists.

### Working with documents

- **A change that makes a document wrong fixes it in the same commit**, and
  moves its `Updated`.
- **Adding, moving, renaming or deleting a document updates `docs/README.md`
  and every link to it in the same commit.**
- **A plan is a document with `Status: Plan`**, in the category it changes.
  When the work lands, the plan is rewritten to describe what was built and
  becomes `Current`, or it is deleted. There is no plans directory, no dated
  plan file, and no plan left at `Plan` after its work shipped.
- **A decision gets an ADR when undoing it later would be expensive**: a
  storage or wire format, a key hierarchy, a public API or what a key may do,
  how money moves, what the product deliberately will not do, the shape of the
  repository or of the deployment. It is written in the commit that acts on the
  decision, while the rejected options are still remembered. A choice one commit
  could undo is a code comment, not an ADR. A repository whose code already
  cites a numbered decision log keeps that log instead; there is never both.
- **A superseded document is deleted once nothing cites it**; git keeps it. One
  still cited is marked `Superseded by …` or `Archived`, and kept.
- **Link between documents with relative paths.** A code comment cites a
  repository-relative path and a section: `docs/tech/billing.md §3`.
- **The repository is where a document lives.** A copy in Notion or in a chat is
  not authoritative, and a working note, a status report or a summary of a
  session is not a document at all.
- **`pnpm lint:docs` (`scripts/lint-docs.mjs`) checks what a machine can**: the
  layout, the names, the header, that no version line or revision history is
  left, that each tree's `docs/README.md` reaches every document in it, and
  that every relative link resolves. It runs in the gate; the rest of this
  section is review's job. The script is kept verbatim across the siblings,
  like this section.

### The changelog

`CHANGELOG.md` at the root records every key change to the system, newest first
and dated rather than versioned, whether or not a release was tagged. An agent
starting a task reads its top to learn what moved recently. It is a curated
summary, not a list of commits; git keeps the detail.

- **A key change gets its entry in the commit that makes it.** Key means a
  schema migration; an environment variable added or removed; a request,
  response or storage format; sign-in, keys or billing; the deployment; a pinned
  dependency moving; the stage; an app or package added or removed; and anything
  a user sees. A refactor, a test or a typo does not. Commits that make one
  change together share one entry.
- **Each entry is `## YYYY-MM-DD — what changed`**, followed by these lines:
  - `- **What:**`
  - `- **Why:**`
  - `- **Breaking:**` — who is affected and how they get across, or `None`
  - `- **Upgrade:**` — migrations, variables and deploy steps, or `Nothing`
  - `- **Refs:**` — commits, ADRs and documents
- **Old entries are compacted.** Every so often, entries older than about ninety
  days fold into one `## Before YYYY-MM-DD` section at the end. It keeps only
  what still constrains today: a migration, a break, something removed.
  Compacting is a commit of its own.
- **It is not release notes.**
- `pnpm lint:docs` checks the shape: the file exists, dated sections run newest
  first, each has `What` and `Upgrade`, and at most one `Before` section comes
  last.

### In this repository

Seed (`~/code/shushuo/seed`) is where this section is written; a change to it
lands there first and is copied here. The index is
[`docs/README.md`](docs/README.md). [`docs/design.md`](docs/design.md) is
the product's own system — the whale mark on an indigo plate, indigo and paper
— and is read before changing `docs/brand/icon.svg`, a token or the logo. The
mark is drawn edge to edge on its plate, so here the logos keep the plate
(rounded) instead of seed's plate-less black and white pair.

**Published mailboxes: `privacy@` and `support@` on the product's root domain, and no others.** `privacy@` takes data requests and account deletion, `support@` everything else; no `hello@`, `legal@` or per-purpose address, and no `mail.` or `send.` subdomain in anything a person reads. The sending service may use a subdomain internally; nobody is told to write to one. A product started from seed writes its own domain in place of `[Product domain]`.

The published legal pages belong to the hosted service: where they live, their
one format and the test that holds them are in `premium/CLAUDE.md`, where that
directory exists.
