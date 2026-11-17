# Changelog

Every key change to DSH Teamwork, newest first, by date. An agent starting a
task reads the top of this file to learn what moved recently; git holds the
detail. What counts as key, the entry format and how old entries are compacted
are in `CLAUDE.md`, "The changelog".

## 2026-11-17 — The landing page's first screen: an install card and real screens

- **What:** The hero drops its two buttons (creating a team and self-hosting stay in the top bar) for one card beside the title: DSH Desktop's `Plugins → Add plugin` with the package to copy, the command-line install, and the guide; the title and that card sit on the left. On the right, real captures of DSH Desktop's Teamwork panel, the web console and the phone app (labelled hosted), one set per language, in `apps/console/public/home/`.
- **Why:** The first screen repeated the top bar's actions, gave installing a single grey line, and showed no product.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/public/home.tsx`, `docs/design.md`.

## 2026-11-17 — Analytics count pages only; the app's token can delete the account

- **What:** The server sends nothing to PostHog any more: the `user_signed_up` and `profile_updated` events and `server/internal/analytics` are gone. The browser stays cookieless and anonymous and now sends `$pageview` only, with page leaves off. `DELETE /api/profile` also takes a Bearer token with the email typed back, so the phone app can delete the account in place; the `browser_only` refusal is gone.
- **Why:** No tracking of what a person or an account does; the App Store requires in-app account deletion.
- **Breaking:** PostHog receives no account events from now on; queries over them stop growing. A plugin token can delete its account given the account's email.
- **Upgrade:** Nothing. `POSTHOG_KEY` keeps its meaning for the browser.
- **Refs:** ADR 0040, `docs/ops/analytics.md`, `apps/console/src/lib/analytics.ts`.

## 2026-11-17 — The operator console follows the visual system

- **What:** The operator console's rail ends in the operator's initial, the theme and signing out, with the address only on hover; `@dsh-teamwork/manage-core` exports the console's custom `Select` (`./components/ui/select`) so an edition's pages draw no native select. The landing page's Chinese install line names DSH Desktop's menu as the app does, `Plugins → Add plugin`.
- **Why:** The last screens that printed an email in the chrome or drew a native select; the install line now matches the plugin's own guide.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md`, `apps/manage/src/components/layout/sidebar.tsx`, `apps/manage/src/components/ui/select.tsx`.

## 2026-11-17 — People can delete their own account, and an admin can hand the role over

- **What:** `DELETE /api/profile` (browser session, email typed back as `confirm`) deletes the account, its identities, password and memberships, and every team it is alone in with all of that team's rows and artifact bytes. It is refused (`admin_of_shared_team`) while the account administers a team with others in it; `POST /api/teams/{teamId}/members/{userId}/admin` hands the admin role to a member, and the caller becomes a member. Editions hear `TeamDeleted` and `AccountDeleted` through `Host.SubscribeTeams` and may refuse. The account page gets a Delete account section; the members page gets Make admin.
- **Why:** Deletion was by email only, and a team's one admin had no way to leave it.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** ADR 0039, `server/internal/team/account.go`, `apps/console/src/pages/account.tsx`.

## 2026-11-17 — The review and history pages show changes field by field

- **What:** `GET /api/teams/{teamId}/submissions` takes a `state` filter. Sharing and review opens on the review queue for an admin (on a member's own submissions otherwise), with the other view one tab away; submitting a preset or a plugin is a dialog with a drop zone (a plugin archive is still inspected in the browser and checked by digest); each submission is a row that opens to show its change field by field against the live version, and approve, reject (reason required) and withdraw confirm in a dialog. Versions and backups is a timeline with one row of filters (kind, resource, author, any / 7 / 30 days / a custom range of whole days); the live version is marked, any other shows what restoring it would change, and restoring confirms in a dialog that links to review.
- **Why:** Both pages were native file inputs, raw JSON side by side and inline confirmations.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/pages/team/sharing.tsx`, `apps/console/src/pages/team/history.tsx`, `apps/console/src/lib/config-diff.ts`, `docs/tech/team-assistant.md`.

## 2026-11-17 — A management process no longer prints or accepts the first-account link

- **What:** With `SERVICE_ROLE=manage`, the server no longer prints `/setup?token=…` at start and no longer serves `POST /api/auth/setup`. The combined and user processes keep both, so a single-process install's first run is unchanged.
- **Why:** A management service with no email door fell back to passwords and wrote a live first-account link into its log on every start, where a hosting provider's log viewer shows it, although its accounts are claimed on the shared database where members sign in.
- **Breaking:** None for a single-process install. A split install claims its first account on the user process.
- **Upgrade:** Nothing. A link already printed by a management process stops working there once it is updated.
- **Refs:** `server/app/app.go`, `server/internal/httpapi/server.go`, `docs/tech/system-management.md`.

## 2026-11-17 — Computer tokens for a cloud computer's plugin

- **What:** A new kind of sealed Bearer, the computer token: one member, one team, at most an hour, minted only through `edition.Host.MintComputerToken` for a member of that team. `GET /api/configs` returns that team alone for it, the model gateway refuses any other team's model, and every other route treats it as nobody. Membership is re-read on every request.
- **Why:** An agent in a cloud computer can read the plugin's token; a member's 30-day plugin token would let it act as the member everywhere.
- **Breaking:** None. `Gateway.Completions` takes the caller's team scope.
- **Upgrade:** Nothing.
- **Refs:** ADR 0038.

## 2026-11-17 — A redesigned /teams, a wider landing page, a theme switch and one select

- **What:** `/teams` gets the site's top bar and footer, team cards (initials on navy, with overview, models and members one click away) grouped by role, a welcome with the first steps for a person with no team, and create/join in dialogs; an `?invite=` link opens the join dialog filled in. The landing page widens from `max-w-5xl` to `max-w-6xl`. A theme button switches between light and dark (the system's setting until a person chooses; the choice is kept in `localStorage` under `theme`, the instance console's key, whose own picker drops its "system" option) and sits in the top bar and footer of the landing page, the docs and `/teams`, and beside the account in a team's sidebar; the first paint follows it. The person is shown by their avatar: a team's sidebar ends in a row of avatar, name and role (after Router9 Studio's rail) and top bars show the avatar alone, both leading straight to a new account settings page (`/account`: name edited in place, email, language, light or dark, password where the instance holds passwords, your teams, sign out). The account dropdown is gone, and the email is printed only on that page. Every native `<select>` is replaced by one custom select (`components/ui/select.tsx`), the language picker included; the public pages draw the same look without React. The old picker's menu was transparent (`bg-popover` is not a token); it now uses the card surface.
- **Why:** The teams page was a narrow column with forms always open, the theme could not be chosen, and native selects broke the visual system.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/pages/teams.tsx`, `apps/console/src/lib/theme.ts`, `apps/console/src/components/ui/select.tsx`, `apps/console/src/public/controls.tsx`, `docs/design.md` ("Colour", "Component rules").

## 2026-11-17 — The team overview opens with what waits on you

- **What:** `GET /api/teams/{teamId}/summary` returns, scoped to the caller, the last 30 days' calls and points, calls left unpriced, calls an admin must resolve, budget mail that failed, budget windows past a notice threshold (80, 95, 100 %), the caller's quota summary and submissions awaiting review. The console's overview opens with that list (each row links to the page that deals with it) and a strip of figures, keeps the getting-started checklist only until it is done, and explains joining in three steps with a copyable message for new members. An admin's sidebar marks "Sharing and review" with an amber dot while submissions wait.
- **Why:** The overview counted configuration rows and could not say what needed doing.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/usage/summary.go`, `apps/console/src/pages/team/overview.tsx`, `docs/tech/usage-budgets.md` ("API and console").

## 2026-11-17 — Editions can register meters with the budget engine

- **What:** An edition registers its own kinds of usage (`edition.Host.RegisterMeters`): it holds points for a member before metered work starts and settles the measured quantity and its points afterwards, in the same windows, reservations and transaction as model calls, with its funding participant. Team and member point budgets bound them; provider budgets and token limits do not. `usage_requests` gains `meter` and `quantity`; the usage API's entries gain `meter`, the CSV export gains `meter`, `quantity` and `unit`, and the console's Usage page names a metered row by its labels. An unsettled hold is marked lost and stays held; an administrator cannot resolve a metered row.
- **Why:** The hosted edition's cloud computers must count against the same member and team budgets as model calls, without a second budget engine.
- **Breaking:** None. The CSV export has three more columns at its end.
- **Upgrade:** One migration, applied at start. Nothing else.
- **Refs:** ADR 0036, `docs/tech/usage-budgets.md` ("Edition meters").

## 2026-11-17 — Documentation at /docs, and a one-line install on the home page

- **What:** Every instance publishes user documentation at `/docs` in English and Chinese: an overview, installing the plugin (Desktop, CLI and web, signing in, choosing the server, common problems), setting up a team, working in one, the command reference, and running your own server. Pages are Markdown in `apps/console/content/docs/{locale}/`, prerendered with the other public pages and served in the viewer's language like the home page; the sitemap lists them. The home page's first screen now shows one line for installing from DSH Desktop and links to the full guide; its header and footer link the docs, and the self-hosting guide button opens `/docs/self-hosting`. The community edition is no longer described as installable from npx, which is not published.
- **Why:** Installing the plugin is the step everything else depends on, and it needs more than a first screen can hold.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/public/docs.tsx`, `apps/console/content/docs/`, `server/internal/web/web.go`, `CLAUDE.md` ("Language", "In this repository").

## 2026-11-17 — The landing page tells the team story; the console's sidebar is grouped

- **What:** The home page is rewritten around "from super individual to super team": what changes when a team shares its agents, every platform the team works on (terminal and web console available, the mobile app on the hosted service, DSH in the cloud marked as coming), collaboration (presets, plugins, the team assistant, share and review), governance (budgets, usage, keys, membership) and, on the deep floor, the team's assets (versions, restore, export). Its primary call is "Create a team", with "Run it yourself" beside it. Narrow screens get a section menu. The FAQ no longer says a person can be in one team only, and states where provider keys really live. The team console's sidebar groups its pages into Team assets, Collaboration and Governance, gives each page its own icon, moves the account, password, language and sign-out into one menu, and becomes a sheet on narrow screens.
- **Why:** The page described only configuration sync, while usage, budgets, reviewed sharing, history and the assistant had shipped; and the flat nine-item sidebar mixed what a team publishes with what it governs.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/public/home.tsx`, `apps/console/src/components/team/console-shell.tsx`, `docs/design.md` ("Component rules").

## 2026-11-16 — Neutral black-and-white palette with navy and amber accents

- **What:** The web app and the console drop the warm paper and indigo-tinted scale for neutral greys: black primary buttons in light, white in dark, the same frame as DeepSeek Harness. `--brand` stays navy and marks team identity only; a new `--signal` (amber) marks what needs attention. The landing page drops its navy ocean for a black wave line with the fluke faint behind it and one navy closing band; the console's selected section is a grey fill with a navy bar, and pending reviews carry an amber dot. The share card is drawn on white.
- **Why:** Teamwork lives inside DSH; a neutral frame lets the plugin, the web app and the mobile app read as one product with it, while navy and amber set the team edition apart.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md` ("Colour", "Component rules"), `apps/console/src/globals.css`, `apps/manage/src/globals.css`, `apps/console/src/public/home.tsx`.

## 2026-11-16 — The brand mark's fluke rises from a layered sea

- **What:** The mark's thin wave line becomes a full sea in three tones (deep water, a light surface, two swell bands) that covers the fluke's stalk; the fluke keeps its size and the surface its height. Every icon and logo is re-exported.
- **Why:** The stalk cut off below a thin line read as a severed tail.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** ADR 0035, `docs/design.md`, `docs/brand/icon.svg`.

## 2026-11-16 — Bilingual product documentation and self-hosting guide

- **What:** English-first and Simplified Chinese user READMEs explain team resources, reviewed sharing, service boundaries and supported installation paths. A self-hosting runbook covers retained local/S3 artifacts, verification and consistent backups.
- **Why:** Members and self-hosted teams need a usable first-run path and documentation that distinguishes the published DSH plugin from the unreleased server package.
- **Breaking:** None.
- **Upgrade:** No application migration or configuration change. Documentation checks allow only the requested root Chinese README and its language-navigation label.
- **Refs:** `README.md`, `README.zh-CN.md`, `docs/ops/self-hosting.md`.

## 2026-11-16 — Team-scoped private plugin paths

- **What:** Both storage providers use `teams/{teamId}/plugins/{artifactId}.tgz`. Startup and authenticated reads migrate referenced flat objects with size/SHA-256 verification; `--migrate-artifact-paths` runs the same pass offline.
- **Why:** Team-owned prefixes enable inventory and future cleanup without weakening authorization or losing existing archives.
- **Breaking:** Physical keys change; database identity and API URLs do not. Returning to an old binary requires verified flat copies of uploads made after this upgrade.
- **Upgrade:** Keep database/store backups and existing credentials. Startup verifies/migrates existing records before serving, retaining flat sources; missing or corrupt bytes stop readiness. No schema migration. Keep old copies until old writers retire; no automatic cleanup is introduced.
- **Refs:** ADR 0034, `docs/tech/team-assistant.md`.

## 2026-11-15 — Local and S3 private artifact storage

- **What:** Private plugin uploads, downloads, approval and backups use local-directory or S3-compatible storage. Environment variables select the provider; an offline migration command copies and verifies retained bytes.
- **Why:** Hosted archive files must survive container replacement, while community deployments keep a local default.
- **Breaking:** None; local directory keys and API metadata are unchanged.
- **Upgrade:** Local installations need no change. To select S3, provision a private bucket, configure `ARTIFACT_STORAGE_PROVIDER=s3` and its `ARTIFACT_S3_*` variables, stop writes and run `--migrate-artifacts` against the retained local directory before switching. Preserve database and archive backups together.
- **Refs:** ADR 0033, `docs/tech/team-assistant.md`.

## 2026-11-15 — Edition actions in the instance team directory

- **What:** The shared management console accepts team actions in directory rows and detail headers.
- **Why:** Editions can link a selected team to their operations without copying the directory.
- **Upgrade:** Nothing; the community default is unchanged.
- **Refs:** `docs/tech/system-management.md`.

## 2026-11-15 — Community instance management and explicit service roles

- **What:** Platform owns the shared `/manage` console and administrator API, user/team directories, instance counts and non-secret diagnostics. Editions extend its routes and UI. `SERVICE_ROLE` selects combined, user or management surfaces.
- **Why:** Self-hosted teams need instance administration, while separate operator services must not expose member workloads.
- **Breaking:** Isolated user processes refuse management; management processes refuse team APIs, plugin authorization and model calls. An instance administrator is an explicit `ADMIN_EMAILS` entry, not a team role.
- **Upgrade:** Build both console apps before embedding. Set `ADMIN_EMAILS`; optionally choose `SERVICE_ROLE`. No database migration. Separate user and management services share the database and provider encryption key but retain distinct session secrets.
- **Refs:** `docs/tech/system-management.md`, ADR 0032.

## 2026-11-15 — Reviewed resource sharing and historical backups

- **What:** Members submit preset/plugin creations and updates; admins approve frozen revisions. Direct admin writes share transactional history. Private archives are inspected, digest-pinned and access-controlled. Time-based history supports comparison, resource/dependency export and reviewed restoration, including deleted resources and retained plugin pins. Host-approved assistant tools connect sharing and supported management operations.
- **Why:** Teams need local-resource sharing without granting publication rights, and recoverable updates with exact plugin bytes.
- **Breaking:** Sync adds referenced historical plugin metadata. Publish the matching plugin with the server; new private archives are not public npm packages.
- **Upgrade:** Apply all append-only migrations and persist/back up both the database and the data directory's artifacts. Existing configs receive a legacy baseline before their first edit/deletion. Retained history is not automatically purged.
- **Refs:** `docs/adr/0030-reviewed-resources-and-publication-history.md`, `docs/tech/team-assistant.md`.

## 2026-11-15 — Default team assistant and inherited preset models

- **What:** Team creation includes a uniquely identified assistant preset. Presets may explicitly inherit the session model. The console and plugin preserve this choice, and scoped assistant tools read team resources, usage, budgets and membership or sync configuration.
- **Why:** New teams need an entry point that works before they configure a team model.
- **Breaking:** Config names accept up to 120 characters; preset data adds an exclusive inherited-model choice.
- **Upgrade:** Apply the new migrations on all three dialects and update the plugin with the platform. Existing teams are not automatically modified.
- **Refs:** `docs/tech/team-assistant.md`.

## 2026-11-15 — Linux CI with community distribution checks owned by Platform

- **What:** Both repositories run CI on Linux. Platform packs and smoke-tests npm packages in one job and owns Docker self-host verification; downstream editions retain the full integrated build gate. New runs cancel older runs for the same pull request or branch.
- **Why:** Avoid repeating community packaging and self-host checks in downstream editions, and remove the macOS/Windows runner matrix and artifact transfer between packing and installation.
- **Upgrade:** No runtime or database change. Release artifacts still target all supported platforms; routine CI installation checks exercise Linux only.
- **Refs:** `.github/workflows/ci.yaml`, `docs/tech/community-edition.md`.

## 2026-11-15 — Member quota summaries for companion clients

- **What:** Budget reads include the authenticated member's effective point availability after holds, token-cap status and uncertain usage. Administrator summaries exclude other members and provider-specific caps; reads create no accounting windows.
- **Why:** Companion clients need a small advisory display without reimplementing budget inheritance or claiming a prepaid wallet is a usage allowance.
- **Upgrade:** No schema change. Clients must still handle provider constraints at actual admission and treat an unknown summary as unavailable.
- **Refs:** `docs/tech/usage-budgets.md`.

## 2026-11-15 — Edition team pages in console navigation

- **What:** Installed editions register same-origin team page prefixes and localized labels. Session metadata exposes the entries, the sidebar keeps the selected team, and public sign-in returns load the edition document instead of falling through to the team list.
- **Why:** Separately embedded member apps need a discoverable entry without importing closed code or introducing another authentication flow.
- **Upgrade:** Session responses include an empty `teamPages` array on community installations. Navigation registration grants no API permissions.
- **Refs:** `docs/adr/0028-edition-team-navigation.md`.

## 2026-11-15 — Transactional edition team provisioning

- **What:** Edition subscribers receive actual team creation and member joins inside the public mutation transaction, through an owner-scoped borrowed SQL executor. Creation includes the true creator and emits no additional join. Both member-addition paths propagate callback failure before commit.
- **Why:** Edition records must not be lost after a membership commits or duplicated by browser retries.
- **Upgrade:** No schema change or community subscriber. Handlers run only for new mutations and must keep SQL work short; external work requires an extension-owned durable work item.
- **Refs:** `docs/adr/0026-transactional-team-events.md`.

## 2026-11-15 — Optional model funding shares budget transactions

- **What:** A named edition participant supplies protected model routes and immutable retail quotes, then reserves and settles through the public accounting transaction. The host lends a transaction-bound executor, team permissions and scoped model publication. Missing participants fail closed; BYOK never invokes funding. Hosted reconciliation is operator-only, and every strict request retains its admitted bounds even without a team policy. The console displays protected prices as read-only.
- **Why:** A separate prepaid check can overspend or leave wallet and budget counters inconsistent after failure.
- **Upgrade:** The binary applies the append-only route/bound migrations. Community installations register no funding participant and keep their existing BYOK behavior. No hosted credit or payment processor is activated by this change.
- **Refs:** `docs/adr/0024-atomic-model-funding.md`, `server/edition/funding.go`.

## 2026-11-15 — Community budgets, recovery and usage export

- **What:** Daily/monthly team, per-member default/override and provider point/token caps reserve atomically before dispatch and settle against immutable prices. Policy edits preserve consumption; timezone changes wait for a boundary. The console adds budget management, scoped CSV exports, explicit estimated reconciliation and optional 80/95/100 percent SMTP alerts with retry history. Lost calls retain their holds; observed bound overruns suspend the route until reviewed.
- **Why:** Teams need enforceable usage governance independently of hosted prepaid balances.
- **Breaking:** Enabled hard budgets require a verified route: initially direct DeepSeek text/function calls. Other BYOK routes remain measurable with enforcement disabled. Full-context input reservations are conservative; a small remaining allowance may not admit even a short prompt.
- **Upgrade:** The binary applies the new public migrations. Existing teams have no automatic caps. Configure model reference rates, then budgets. Existing SMTP settings enable budget mail; without SMTP use the console. No wallet or live payment is enabled.
- **Refs:** `docs/adr/0023-community-budget-reservations.md`, `docs/tech/usage-budgets.md`.

## 2026-11-14 — Community model reference prices and usage records

- **What:** Admins publish revisioned model reference rates from Models. The gateway snapshots rates before dispatch, observes JSON/SSE token usage and stores exact reference points; Usage shows team records to admins and only personal records to members. Unpriced and interrupted calls stay explicitly unpriced/pending. Referenced presets use their model's rates. Public schemas/migrations cover SQLite, Postgres and MySQL. Console routes load on demand to keep new administration forms out of the initial bundle.
- **Upgrade:** The binary applies the new public migrations. Set model rates to value future calls; existing calls are not repriced. This slice records usage and does not yet enforce budgets or charge money.
- **Refs:** `docs/adr/0021-community-usage-and-budgets.md`, `docs/adr/0022-reference-usage-accounting.md`, `docs/tech/usage-budgets.md`.

## 2026-11-14 — The Node server is gone; the Go binary is the only server

- **What:** `apps/web` (Next.js and Auth.js), `packages/db` (Prisma, PGlite and their migrations), the server half of `packages/shared` and the parity run are deleted. `packages/shared` keeps the languages and `matchLocale`, which `apps/console` now imports. `pnpm dev:setup` starts Postgres 16 and MySQL 8.4 for the Go suites and prints the four variables they read; `dev:shared`, `dev:web`, `build:web`, the `postinstall` and every `db:*` script but `db:drift` are gone, as are `railpack.json`, `DATABASE_URL` and `SHADOW_DATABASE_URL` in CI, and the PGlite test run. `CLAUDE.md`, the README, `docs/tech/architecture.md` and `docs/tech/community-edition.md` describe the Go server.
- **Why:** Phase 6 of `docs/tech/go-server.md`: the binary serves everything the Node server did (ADR 0014).
- **Breaking:** A local database made by Prisma or PGlite is not read by the binary; there is no move, as the plan decided. Contributors' `.env` files for `apps/web` and `packages/db` no longer do anything.
- **Upgrade:** `pnpm install`; `pnpm dev:setup` for the new dev stack, on volumes of its own, and export what it prints. The old stack's `pgdata` volume is no longer used: `docker volume rm dsh-teamwork-dev_pgdata`.
- **Refs:** `docs/tech/go-server.md`, `docs/adr/0014-one-go-binary.md`, `dev/docker-compose.yaml`.

## 2026-11-14 — The Go server reads PROVIDER_KEYS_SECRET as the Node server did

- **What:** `PROVIDER_KEYS_SECRET` is decoded like Node's `Buffer.from(s, 'base64')`: the standard and URL-safe alphabets, padding optional, whitespace ignored. It must still be 32 bytes.
- **Why:** A key the Node deployment held, copied onto the Go server, stopped it at start: the Go server read only padded standard base64.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/config/config.go`.

## 2026-11-14 — The Go server has an extension point for a closed edition

- **What:** `server/app` runs the server, and `cmd/dsh-teamwork` only calls `app.Main`. `server/edition` is what a closed package registers from its `init`: its own migrations per dialect, applied after the open history and recorded in `schema_migrations` as `<name>:<version>` (a set missing the running dialect stops the start), its routes on the server's mux, and a `stop` the server calls on shutdown before the database closes. The host lends it the database, Bearer and session verification, the same-origin check and an accounts interface. `server/edition/editiontest` serves the real server with extensions mounted, on each reachable database, for closed tests. The language check admits locale files a Go package embeds (`server/**/messages/*.json`); CI and the pre-push hook run every Go module's `e2e` directory; the workspace globs include `premium/server`. The community binary registers nothing.
- **Why:** Phase 5 of `docs/tech/go-server.md`: the closed edition is the same binary with closed packages compiled in (ADR 0014).
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/app/`, `server/edition/`, `server/internal/db/migrate.go`, `docs/tech/go-server.md`.

## 2026-11-14 — Self-hosting runs the Go server: npx, release binaries and the image

- **What:** `compose.yaml` runs one container built from `server/Dockerfile` (the console embedded, a static binary on distroless), with the SQLite file and the generated secrets in a volume and no `.env` required; Postgres is no longer part of it, and `DATABASE_URL` in a `.env` beside it points the server at Postgres or MySQL instead. `apps/web/Dockerfile` is gone. A tag `v<version>` runs `.github/workflows/release.yaml`, which publishes `@dsh-teamwork/server` and its five platform packages to npm (`npx @dsh-teamwork/server`), the five binaries with `SHA256SUMS` on a GitHub release, and `ghcr.io/dsh-teamwork/server` for amd64 and arm64. CI also runs the Go suites on SQLite, Postgres 16 and MySQL 8.4, the Go drift check per dialect, the DSH plugin's end-to-end test, and the packed release through `npx` on Linux, macOS and Windows; `server/` is a workspace package, so the gate needs Go.
- **Why:** Phase 4 of `docs/tech/go-server.md`.
- **Breaking:** A self-hosted instance on the old `compose.yaml` keeps its data in the Postgres volume, which the new file no longer starts. Nothing has been released before this, so no instance is known to exist.
- **Upgrade:** Contributors install Go (`server/go.mod`). The repository needs an `NPM_TOKEN` secret, with publish rights to the `@dsh-teamwork` scope, before the first tag.
- **Refs:** `server/Dockerfile`, `server/scripts/pack.mjs`, `server/npm/launcher.js`, `.github/workflows/ci.yaml`, `.github/workflows/release.yaml`, `README.md` ("Self-hosting").

## 2026-11-14 — The Go server serves the whole API, and the console beside it

- **What:** `server/` is the Go binary of ADR 0014, with `apps/console`, a Vite and React console built into it. It serves every route of `apps/web`'s API, described in `api/openapi.yaml`, on SQLite, Postgres or MySQL: the first account's setup link, password sign-in, emailed codes over SMTP, Google (through `github.com/markbates/goth`, at Auth.js's callback path `/api/auth/callback/google`), `/plugin` and the token exchange, teams, members, invitations, configurations, providers, the model catalogue, the profile, `GET /api/configs` and the model gateway, with server analytics to PostHog. An account is no longer its email: an `identities` table records each door, and a Google sign-in with a verified email joins the account that address has. The console has every page of the Next app: sign-in, the teams list and each team's overview, models, presets, plugins and members, and the account with the language picker (`POST /api/locale`). The home page and the legal pages are prerendered at the console's build, home in each language and sign-in state, privacy and terms from `LEGAL_DIR` as before; the binary fills in `APP_URL` where they name the site, and serves `robots.txt`, `sitemap.xml`, the share card and the www/apex redirect. Not deployed: the Node server still serves every instance.
- **Why:** Phases 1 to 3 of `docs/tech/go-server.md`.
- **Breaking:** None. Nothing runs the binary yet.
- **Upgrade:** Nothing. For the binary, when it is deployed: `DATABASE_URL` also takes `mysql://` and `sqlite:///path`, and with none the database is SQLite in the data directory (`--data`, default `~/.dsh-teamwork`), which also holds `secrets.json`, written on first start; `HOST` and `--host` choose the address, loopback by default; `AUTH_SECRET` must be at least 32 characters; `AUTH_EMAIL_FROM`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` keep their meaning; analytics, the server's and the browser's, read `POSTHOG_KEY` and `POSTHOG_HOST` at run time in place of `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`; `LEGAL_DIR` is read when the console is built (`pnpm --filter @dsh-teamwork/console build`), and `APP_URL` only at run time.
- **Refs:** `docs/adr/0014-one-go-binary.md`, `docs/tech/go-server.md`, `server/`, `apps/console/`, `api/openapi.yaml`.

## 2026-11-13 — The team console gets a sidebar and a page per task

- **What:** `/teams/{teamId}` is a console with a sidebar: a team switcher (every team the person is in, with their role; switching keeps the page), one link per page, and the account. `/teams` groups the person's teams into those they manage and those they joined. Members have their own page, `/teams/{teamId}/members`, as a table with invitations or account creation beside it; a member leaves the team from there. Models have their own page, `/teams/{teamId}/models`: an admin picks a provider from a list of nine OpenAI-compatible ones (DeepSeek, OpenAI, Qwen, Kimi, Zhipu GLM, Doubao, MiniMax, SiliconFlow, OpenRouter), pastes only its key, reads its model list and publishes several models at once; any other provider is entered by address. Each team model shows which presets use it, and a model or plugin a preset still uses cannot be removed (`409 model_in_use`, `plugin_in_use`). Presets have their own page, `/teams/{teamId}/presets`: an admin starts one from three persona templates (writer, data analyst, research analyst) or from nothing, and edits it in three tabs (basics; DSH tools, each required, optional or off, and plugins; persona and method). Plugins have their own page, `/teams/{teamId}/plugins`. `GET /api/teams/{teamId}/model-catalog` now requires `?provider=`. The overview, `/teams/{teamId}`, counts the team's models, presets, plugins and members, gives an admin a four-step setup checklist and members the command to connect DSH, and lists the latest configuration changes.
- **Why:** The single long `/team` page mixed every task; each task now has a page.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/components/team/console-shell.tsx`, `apps/web/src/app/teams/[teamId]/layout.tsx`, `apps/web/src/lib/provider-catalog.ts`, `apps/web/src/lib/preset-templates.ts`.

## 2026-11-13 — A person may be in several teams

- **What:** A membership is keyed by user and team, so one account can be in any number of teams, admin in some and member in others. The console moves from `/team` to `/teams` (the list, create, join) and `/teams/{teamId}`; the API from `/api/team/*` to `/api/teams/{teamId}/*`, where a team the caller is not in is `404 team_not_found`. The plugin's snapshot moves to `GET /api/configs` and lists every team: `{ teams: [{ teamId, teamName, role, configs }] }`. The gateway resolves a model to its own team and calls that team's provider. Invitation links are `/teams?invite=…`; `no_team` is gone. An admin cannot reset the password of a member who is also in another team (`member_in_other_team`).
- **Why:** One person working for more than one team needed one account per team. ADR 0013.
- **Breaking:** Plugin 0.6 cannot read the new snapshot and stops syncing until upgraded to 0.7.0. Links to `/team` and `/team?invite=…` answer 404. Any script calling `/api/team/*` moves to `/api/teams/{teamId}/*`.
- **Upgrade:** `pnpm db:deploy` (migration `memberships_per_team`: the key becomes `(user_id, team_id)`; existing rows are unaffected). Publish plugin 0.7.0 the same day as this server.
- **Refs:** `docs/adr/0013-one-person-many-teams.md`, `apps/web/src/lib/team.ts`, `apps/web/src/lib/llm-gateway.ts`, `packages/shared/src/team.ts`.

## 2026-11-13 — The DSH plugin gets its sign-in code back on loopback

- **What:** `/plugin` also accepts a `redirect_uri` of `http://127.0.0.1:<port>/…`, on every deployment and with no configuration. Pressing Authorize sends the browser there with `?code=…`, and the `/teamwork authorize <code>` line stays on screen in case it does not arrive. `localhost`, `[::1]`, https and a missing port are refused, and still make the link invalid.
- **Why:** The first sign-in no longer has a copy-and-paste step. The plugin listens on that address from `/teamwork login` (plugin 0.6.0). ADR 0012.
- **Breaking:** Plugin 0.6.0 sends `redirect_uri` on every login, and a server without this change shows its link as invalid. Upgrade the server with the plugin.
- **Upgrade:** Nothing.
- **Refs:** `docs/adr/0012-the-plugin-gets-its-code-back-on-loopback.md`, `packages/shared/src/server/auth/nextauth/plugin.ts`, `apps/web/src/components/plugin-authorize.tsx`.

## 2026-11-13 — A phone app gets its sign-in code back by redirect

- **What:** `/plugin` takes an optional `redirect_uri`. When it starts with the new `MOBILE_REDIRECT_URI`, pressing Authorize sends the browser to `redirect_uri?code=…` instead of showing the code for pasting, and the code stays on screen in case the app does not open. A `redirect_uri` outside the prefix makes the link invalid. With the variable unset, no code is sent anywhere.
- **Why:** The phone app no longer has to paste a long code. ADR 0010.
- **Breaking:** None.
- **Upgrade:** Optional `MOBILE_REDIRECT_URI` on `web`; the hosted service sets `dshteamwork://sign-in`. Self-hosted instances leave it unset.
- **Refs:** `docs/adr/0010-the-app-gets-its-code-back.md`, `packages/shared/src/server/auth/nextauth/plugin.ts`, `apps/web/src/app/plugin/page.tsx`.

## 2026-11-13 — Auth.js takes its origin from APP_URL

- **What:** With `AUTH_URL` unset, `createNextAuth` sets it from `APP_URL`, so Auth.js builds its OAuth callback from the deployment's public origin instead of the request. `AUTH_URL` leaves `apps/web/.env.example`; one still set wins.
- **Why:** Behind Railway's proxy the request names the container (`localhost:8080`), so Google refused the token exchange with `redirect_uri_mismatch` and the browser landed on `https://localhost:8080/sign-in?error=Configuration`.
- **Breaking:** None.
- **Upgrade:** Set `APP_URL` to the public origin; `AUTH_URL` can be dropped where it equals it.
- **Refs:** `packages/shared/src/server/auth/nextauth/index.ts`.

## 2026-11-12 — The www twin redirects to APP_URL; APP_URL reaches the build

- **What:** In production, the `www`/apex twin of the deployment's origin (`AUTH_URL`, else `APP_URL`) answers a 308 to that origin, path and query kept (`apps/web/canonical-host.mjs`, compiled into the build's redirects). `turbo.json` now passes `APP_URL` and `AUTH_URL` to `@dsh-teamwork/web#build`: strict env mode had stripped them, so the static `robots.txt`, sitemap and canonicals named `http://localhost:3800`.
- **Why:** Auth.js cookies are host-only and Google returns to one callback, so signing in on the twin host failed. The hosted service serves `dshteamwork.com` and `www.dshteamwork.com`.
- **Breaking:** None.
- **Upgrade:** Set `APP_URL` where the web app is built, not only where it runs (on Railway the service variable already is; `compose.yaml` now passes it as a build argument). Redeploy, or `docker compose up --build`.
- **Refs:** `apps/web/canonical-host.mjs`, `turbo.json`; router9's `apps/web/canonical-host.mjs`.

## 2026-11-12 — The web app is the home page; legal pages from LEGAL_DIR

- **What:** The web app's `/` is now the landing page on every instance (what DSH Teamwork is, as a project and a service, and the way in), with its share card and JSON-LD; the start page is gone. `/privacy` and `/terms` are rendered at build from the Markdown in `LEGAL_DIR`, a deployment's own directory; unset, the routes answer 404 and the footer and sitemap leave them out. `next.config` inlines `LEGAL_DIR`, so links follow the build, and `turbo.json` passes it to `@dsh-teamwork/web#build` with any `docs/legal/*.md` in the cache key (strict env mode had stripped it). `react-markdown` and `remark-gfm` join the web app.
- **Why:** ADR 0007: the hosted service drops its separate landing site and `alpha.` subdomain and serves the web app on `dshteamwork.com`, which is also the DSH plugin's default server.
- **Breaking:** A self-hosted instance's `/` changes from the start page to the landing page. Browsers on the hosted service sign in again once its origin moves.
- **Upgrade:** Optional `LEGAL_DIR` at build. The hosted service sets `LEGAL_DIR=premium/docs/legal` and `APP_URL=https://dshteamwork.com` on `web`, and adds Google's OAuth callback for the root domain.
- **Refs:** `docs/adr/0007-one-domain-one-app.md`, `apps/web/src/lib/legal.ts`, `docs/tech/community-edition.md`.

## 2026-11-12 — The plugin's snapshot names the team and the caller's role

- **What:** `GET /api/team/configs` answers `{ teamId, teamName, role, configs }`: the team's name and whether the caller is its `admin` or a `member`, beside the configurations. The plugin's new DSH sidebar panel shows both, and links an admin to `/team`.
- **Why:** The Teamwork panel in DSH names the team a member is in and offers admins the way to the console, without a second request.
- **Breaking:** A plugin that parses the snapshot strictly must accept the two fields; the plugin build released with the panel does.
- **Upgrade:** Nothing.
- **Refs:** `packages/shared/src/team.ts`, `apps/web/src/lib/team.ts`, `docs/tech/architecture.md`.

## 2026-11-12 — The DSH command is /teamwork

- **What:** The plugin's command is `/teamwork` instead of `/team` (`/teamwork login`, `/teamwork authorize <code>`, `/teamwork sync`, …). The plugin sign-in page shows `/teamwork authorize <code>` to paste back, and the web app's copy and these documents name the new command. The web console stays at `/team`.
- **Why:** The developer's call: `/teamwork` names the product, and leaves `/team` to DSH's own team features.
- **Breaking:** A member on a plugin build from before this change types `/team`; the pages now show `/teamwork`. Update the plugin.
- **Upgrade:** Update `@dsh-teamwork/dsh-teamwork`.
- **Refs:** `dsh-teamwork/dsh-teamwork` ac2fe24.

## 2026-11-11 — Providers belong to teams

- **What:**
  - A team's admin adds its model providers in `/team`: a name, an OpenAI-compatible base URL and a key. They are stored in a new `team_providers` table, the key sealed with AES-256-GCM under `PROVIDER_KEYS_SECRET`, write-only.
  - The gateway calls the caller's team's provider. A team model must name one, and a provider in use cannot be removed.
  - `LLM_ROUTES_JSON` and its key variables are removed.
  - New `ALLOW_PRIVATE_PROVIDERS`: without it, only public https addresses; with it, loopback and private networks too, plain http only there. It is checked on save, before each call, and in the connection's own DNS lookup.
  - New routes: `GET`/`POST /api/team/providers` and `PUT`/`DELETE /api/team/providers/:id`.
  - New exact dependency: `undici` 7.30.1.
- **Why:** ADR 0006, Phase 4 step 4 of `docs/tech/community-edition.md`. A team brings its own keys, and an instance needs no operator to write provider routes.
- **Breaking:**
  - Every deployment: team models stop answering (`provider_not_configured`) until the team's admin adds a provider of the same name.
  - The hosted service becomes bring-your-own-key.
  - A self-hosted instance calling a private-network model needs `ALLOW_PRIVATE_PROVIDERS=true`, which `compose.yaml` now sets.
- **Upgrade:**
  - Migration `20261111145658_team_providers`.
  - Set `PROVIDER_KEYS_SECRET` (`openssl rand -base64 32`) and drop `LLM_ROUTES_JSON` and its key variables.
  - Each team's admin adds its providers in `/team`.
- **Refs:** ADR 0006, `apps/web/src/lib/provider-network.ts`, `apps/web/src/lib/provider-keys.ts`.

## 2026-11-11 — Passwords when SMTP_URL is unset

- **What:**
  - Without `SMTP_URL`, sign-in is an email and a password instead of an emailed code. Passwords are kept as scrypt in a new `passwords` table, with ten guesses per account per fifteen minutes.
  - The server prints a link at start that claims the first account.
  - A team admin creates members with a first password, shown once, which they must change before `/team` or `/plugin` open, and resets it the same way.
  - New routes: `POST /api/team/members` and `POST /api/team/members/:userId/password`.
  - A session's `via` can be `password`; the console refuses it.
  - The development fallback that printed a code to the console without SMTP is gone.
- **Why:** ADR 0006, Phase 4 step 3 of `docs/tech/community-edition.md`: an instance with no mail server still has a way in.
- **Breaking:** A development server without `SMTP_URL` now asks for a password instead of printing a code.
- **Upgrade:** Migration `20261111143836_passwords` (`pnpm db:deploy`, or automatic on PGlite). An instance with `SMTP_URL` set needs nothing else.
- **Refs:** ADR 0006, `packages/shared/src/server/auth/nextauth/passwords.ts`.

## 2026-11-11 — PGlite when DATABASE_URL is unset

- **What:** Without `DATABASE_URL`, the apps run on PGlite, an in-process Postgres. Its data directory is `PGLITE_DIR` (default `~/.dsh-teamwork/db`). It applies the committed migrations on first connect and records them as Prisma does. The suites that needed Postgres now always run, on PGlite in memory, and CI runs them on both databases. The apps no longer fall back to the `pnpm dev:setup` stack; the Prisma CLI still does. New exact dependencies: `@electric-sql/pglite` 0.5.16 and `pglite-prisma-adapter` 0.7.2.
- **Why:** ADR 0006: the community edition runs from one command; Phase 4 step 2 of `docs/tech/community-edition.md`.
- **Breaking:** A process started with no `DATABASE_URL` now opens a PGlite directory instead of connecting to `localhost:5432`.
- **Upgrade:** `pnpm install`. Keep `DATABASE_URL` set (as `apps/web/.env.example` does) to stay on Postgres.
- **Refs:** ADR 0006, `packages/db/src/pglite.ts`.

## 2026-11-11 — The community edition is public

- **What:** This repository, `dsh-teamwork/dsh-teamwork-platform`, is the community edition's own home and the upstream of the closed edition. Open changes are made here and merged there. The pre-push hook and CI also run the edition boundary check wherever the closed edition's script exists, which is never in this repository.
- **Why:** ADR 0005; Phase 3 of `docs/tech/community-edition.md`.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/tech/community-edition.md`.

## 2026-11-11 — Apache-2.0, and CI on pull requests

- **What:** The repository is licensed Apache-2.0 (`LICENSE`), with a `NOTICE` keeping the name and the whale mark out of the licence, and a README section asking for a `Signed-off-by:` line on every commit (the DCO). CI runs on every pull request as well as on `main`, and a `self-host` job builds `apps/web/Dockerfile`, starts `compose.yaml` and checks the web app answers. The root `dev:manage` script is gone.
- **Why:** The community edition is about to be published (ADR 0005, `docs/tech/community-edition.md`).
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `README.md`, `NOTICE`, `.github/workflows/ci.yaml`.

## 2026-11-10 — The web app's home page becomes a start page

- **What:** `/` in `apps/web` is a short start page: the logo, the name and tagline, and one way in (sign in, or open your team). The landing page, the share card, the JSON-LD, `/privacy`, `/terms` and their build step (`pull-legal.mjs`) are no longer part of the web app, which drops `react-markdown` and `remark-gfm`. The language check exempts every app's `messages/`; the root `CLAUDE.md` copies seed's lint-docs and Documentation section (a second documentation tree; legal pages only where published).
- **Why:** A self-hosted instance needs a way in, not the hosted service's landing page or its legal pages, which name Shushuo as the controller (`docs/tech/community-edition.md`).
- **Breaking:** `/privacy` and `/terms` are gone from the web app's origin.
- **Upgrade:** Nothing.
- **Refs:** `docs/tech/community-edition.md`, `docs/design.md`.

## 2026-11-10 — The schema moves to a folder; the icon script finds every app

- **What:** The Prisma schema is `packages/db/prisma/schema/schema.prisma`, a folder other `.prisma` files can join; the generator's output, `prisma.config.ts`, the drift script and turbo's input follow it. `pnpm-workspace.yaml` also matches `premium/apps/*` and `premium/packages/*`, which match nothing in the community edition. `generate-icons.mjs` exports for every app it finds instead of a fixed list, so every app gets the same tab, home-screen and logo files.
- **Why:** The community edition split (`docs/tech/community-edition.md`): the open schema and scripts must name nothing they cannot find.
- **Breaking:** None.
- **Upgrade:** `pnpm install`.
- **Refs:** `docs/tech/community-edition.md`.

## 2026-11-10 — The web app can be self-hosted

- **What:**
  - Sign-in codes go over SMTP (`SMTP_URL`, sent with nodemailer) instead of Resend's HTTP API.
  - The Google provider and its button exist only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.
  - The gateway accepts a plain `http://` provider only when its host resolves to loopback or private addresses.
  - `apps/web/Dockerfile` and `compose.yaml` run Postgres and the web app, and the README's self-hosting section explains them.
- **Why:** The community edition must run without Shushuo's services (ADR 0005, `docs/tech/community-edition.md`), including against a model the team serves itself.
- **Breaking:** `RESEND_API_KEY` is no longer read: a deployment sends no sign-in code until it has `SMTP_URL`.
- **Upgrade:** Set `SMTP_URL` (any SMTP server; Resend's is `smtps://resend:<API key>@smtp.resend.com:465`) and drop `RESEND_API_KEY`. Locally, leave it unset to have codes printed.
- **Refs:** `docs/tech/community-edition.md`, `README.md`.

## 2026-11-10 — The product gets its mark and palette

- **What:** `docs/brand/icon.svg` is the whale mark: a paper fluke tilted into a calm sea on an indigo plate (`#1E2F6D`). Both apps' token scales move from seed's greyscale to the brand's: warm paper grounds and indigo ink in light, indigo-black in dark, `--brand` indigo. The in-app logo keeps its plate with rounded corners, so each app has one `public/logo.svg` for both themes; `logo-dark.svg` is gone and `scripts/generate-icons.mjs` exports the logos that way. The share card shows the logo beside the name and tagline, on paper, set in Onest, whose two latin `.woff` files and OFL licence live in `apps/web/assets/fonts`.
- **Why:** The product had seed's placeholder mark and greyscale scale; this is the identity chosen for it.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md`.

## 2026-11-10 — The platform is rebuilt from seed

- **What:** The repository starts again from `~/code/shushuo/seed` at `3f2e262` (`pnpm rename dsh-teamwork 38 --auth nextauth`): Next.js 16 / React 19, Prisma 7 in `packages/db`, Zod 4, Turborepo, the husky gate and seed's docs layout. The MVP's rules are ported onto it: teams, single-use invitations, team configuration (models, presets, plugin pins) with optimistic versions, and the model gateway. The API moved from `/api/v1/*` to one route per resource under `/api/*`, answering `{ error: <code> }` with `TEAM_ERRORS`. Sign-in is Google or an emailed code; the plugin signs in through `/plugin` and `POST /api/auth/plugin/token` with a stateless 30-day token. `apps/api`, `apps/bot-lark`, `website/`, `infra/`, `packages/core`, the mobile app, the store pipeline and `packages/s3` are gone. Local Postgres comes from this repository's `dev/` (`pnpm dev:setup`) or from the shared `~/code/shushuo/dev` stack (`pnpm dev:shared`), with the same database names in both.
- **Why:** Every Shushuo product shares seed's stack, gate and deployment; the MVP had drifted from all three and could not be deployed safely (its only sign-in was a fixed development code).
- **Breaking:** The plugin's API paths, its sign-in exchange and the error shape. `@dsh-teamwork/dsh-teamwork` changes in step; nothing was deployed.
- **Upgrade:** `pnpm install`, `pnpm dev:setup` (or `pnpm dev:shared`), copy each `.env.example`, `pnpm db:deploy`. New variables: `AUTH_SECRET`, `AUTH_GOOGLE_*`, `RESEND_API_KEY`, `LLM_ROUTES_JSON` and the keys it names. Removed: `NEXTAUTH_*`, `DEV_FIXED_OTP*`.
- **Refs:** `docs/adr/0001-plugin-sign-in.md`, `docs/adr/0002-platform-from-seed.md`, `docs/tech/architecture.md`.

## Before 2026-11-10

The MVP (`60d681c`…`4f83905`): a Next.js 15 app with a fixed development OTP
and a hand-written SQL migration runner, which nothing deployed. Its tables
are not carried over; the migration history starts with seed's.
