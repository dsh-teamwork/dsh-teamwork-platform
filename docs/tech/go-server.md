# Go server

> **Status:** Plan — phases 0 to 4 done · **Updated:** 2026-11-14

How the Node server becomes the one Go binary of
[ADR 0014](../adr/0014-one-go-binary.md): the experiments that gate it, what
they found, the order of work, and how done is verified. Rules the experiments
settled are listed under "Rules for the data layer"; they are what the code
must keep.

## Goal

- One binary serves the API, the gateway and the console, on SQLite by
  default and on Postgres or MySQL by `DATABASE_URL`.
- An installed plugin keeps working against it without an update.
- The Node server, Prisma, Auth.js and Next.js are deleted when the binary
  serves everything they did.

## Non-goals

- A change to the plugin's wire.
- Sign-in doors beyond Google, emailed codes, passwords and Feishu.
- A database outside SQLite, Postgres 16 and MySQL 8 in CI. A product in a
  family (openGauss, TiDB, …) is added when a customer asks, by running the
  suites against it.
- Moving data from a Node instance. The project is in the Building stage.

## Order of work

Six phases. Each ends in a gate, and nothing in the next phase starts before
it passes:

1. the phase's checks pass on SQLite, Postgres 16 and MySQL 8;
2. the parity run compares the Node and Go servers on the phase's routes;
3. a code review of the phase's diff (`/code-review`), with every confirmed
   finding fixed and the checks run again.

The Node server stays in the tree until phase 6 deletes it. The parity run
needs it built, so the run is part of each gate, not of every CI run.

### Where the code goes

- `server/`: one Go module. `cmd/dsh-teamwork` is the binary; the rest is
  `internal/` packages by concern (schema and migrations, auth, team rules,
  gateway, HTTP API, embedded console).
- `apps/console/`: the console as a Vite and React app, built into
  `server/` with `go:embed`.
- `api/openapi.yaml`: the wire contract. Go server types and the console's
  client are generated from it.
- `premium/server/`: the closed Go packages, compiled into the closed binary
  only.

`apps/console` restates four small rules from `packages/shared` rather than
depend on it, since that package depends on Prisma and goes in phase 6:
`returnPath`, the PKCE challenge's form, the sign-in error codes and
`matchLocale`. From phase 6 the console's copies are the only ones.

### Phase 0: experiments — done

Three dialects from one schema, the gateway, and packaging; results below.

### Phase 1: the plugin's slice — the gate for everything else

The binary serves exactly what an installed plugin calls, end to end:

1. The module, configuration from today's variable names, a data directory
   that holds the SQLite file and the secrets written on first start, the
   migrations for all three dialects embedded and applied at start, and the
   drift check per dialect.
2. Sign-in by password: the setup link for the first account, the session
   cookie, password change.
3. The plugin's sign-in: `/plugin`, the loopback and pasted code, and
   `POST /api/auth/plugin/token`. A token carries the user's id; the hosted
   service starts empty, so tokens the Node server minted are not carried
   over, and members sign in again once.
4. Just enough of the team API to set a team up: create a team, add a
   provider, publish a model.
5. `GET /api/configs` and `POST /api/llm/chat/completions`, with the
   provider address rule ported in full, checked inside the connection's own
   lookup.
6. `api/openapi.yaml` for these routes, and the plugin's restated shape
   checked against it.

**Verified by:**

- an end-to-end test that starts the binary on each dialect, claims the first
  account, sets a team up, and drives the real plugin (`../dsh-teamwork`):
  login, sync, one streamed and one plain call through the gateway to a stub
  provider;
- a parity run: the same request sequence against the Node server and the Go
  server, with the status and body compared field by field for each route in
  the slice;
- tests on the boundaries: the PKCE exchange, a token for another team, the
  password limit under a burst, a provider address refused without
  `ALLOW_PRIVATE_PROVIDERS`, a DNS answer that changes between check and
  connect, a provider key never in a response.

**Done on 2026-11-14.** What the gate found:

- **Checks on three dialects:** the boundary tests (the slice, the PKCE
  exchange, the guess limit under a burst, the first account under a race,
  team boundaries, the address rule on save and on the socket, the browser
  guards) pass on SQLite, Postgres 16 and MySQL 8, and every answer they
  read matches `api/openapi.yaml`. Two controls showed the tests can fail:
  without the dialer's check, the rebinding test fails; without the guess
  limit, the burst test fails.
- **The plugin, unchanged**, signs in on loopback, syncs and makes a plain
  and a streamed call, on each dialect (`go test -tags e2e ./e2e`).
- **The parity run:** 27 of 29 requests answer the same. The two that do not
  are a provider or a configuration created twice: the Go server answers
  `409`, the Node server `500 internal_error`, because its production build
  carries a second copy of Prisma's error class and `instanceof` misses it.
  That is a bug in the Node server, left for phase 6 to delete.
- **The review** found ten things; nine are fixed:
  - an `AUTH_SECRET` of whitespace started the server on an empty key, so
    anyone could compute the setup link; one under 32 characters now stops
    the start;
  - the guess limit applied only to addresses with an account, which told an
    attacker which accounts exist; guesses are now counted per address;
  - the private ranges now include the IPv6 forms that translate to IPv4
    (NAT64, 6to4, IPv4-compatible);
  - the start log named `127.0.0.1` while `APP_URL` said `localhost`, so the
    logged address refused every write; the log names `APP_URL`, and the
    loopback names are one site;
  - a failed first read of the session left the console loading for ever;
  - a MySQL user name with escapes was mangled without a password;
  - a changelog entry, a repeated query and a repeated rule.

  The tenth, that the console restates four rules from `packages/shared`,
  is kept on purpose, as "Where the code goes" says.

### Phase 2: the rest of the API and sign-in

- Every remaining route: teams, membership, members, admin-set passwords,
  invites, configurations with versions and in-use checks, providers, the
  model catalogue, profile.
- Emailed codes over SMTP and Google. A Google sign-in with a verified
  email joins the account that address already has; the `identities` table
  records each door an account has used.
- Server-side analytics events, with the table and its test.

**Verified by:** every case in today's 24 test files rewritten as Go tests and
run on the three dialects; the parity run extended to every route; Google
against a stub OAuth server in tests, and once by hand against the real one.

**Done on 2026-11-14.** What the gate found:

- **Checks on three dialects:** today's server-side test files are ported:
  the team rules, the gateway and the provider network, the profile, the
  configuration rules, emailed codes, passwords, the plugin hand-off, SMTP
  against a fake server, Google through goth against a stub, and the
  analytics table held to `docs/ops/analytics.md`. With phase 1's, 248 test
  cases pass on SQLite, Postgres and MySQL, every answer against
  `api/openapi.yaml`, and the plugin end-to-end test still passes. The
  browser-side files (crawlers, the sitemap, the legal pages, browser
  analytics) belong to phase 3.
- **The parity run, on every route:** 66 of 69 requests answer the same. The
  three that do not are the Node bug phase 1 found, now also on a rename
  onto a name in use.
- **What porting the tests found:** two first sign-ins racing with one new
  Google account could fail one of them or leave the account made with no
  sign-up reported. The account and its identity are now one transaction.
- **The review** found ten things, all fixed. Three were in the Node server
  too and came across with the port:
  - a team admin adding an address could give a first password, which the
    admin then knew, to an existing account that had none (one made through
    Google), and so take it over with its place in every other team; only an
    account made by that call now gets a first password;
  - a code that could not be emailed still used up one of the address's five
    sends, and stayed valid; it is now given back;
  - editing a configuration could change its kind, taking a model a preset
    uses past the in-use check; a kind no longer changes.

  The rest were the port's own: a lost race inside a caller's transaction
  answered 500 on Postgres, starting a transaction that failed for any reason
  wrote without one, a long Google name stopped its owner signing in, a
  failed Google callback left the browser on a JSON page, Google had no
  timeout, the team list loaded every member to count them, and the
  changelog. Testing the long-name fix found that the schema's limits
  counted bytes where the API counts characters, so a Chinese team name of
  34 characters was a server error; columns now hold four bytes per
  character the API allows.

### Phase 3: the console

- The pages: sign-in, setup, password, account, plugin, the teams list, and a
  team's overview, models, presets, plugins and members; English and
  Simplified Chinese from today's message files.
- The public pages: home, privacy and terms, with `robots.txt`, the sitemap,
  canonicals, the share card and the JSON-LD.

**Verified by:** a Playwright run of every page's main flow in both locales
against the binary; screenshots of each page next to today's for review; the
SEO test ported to the public pages.

**Done on 2026-11-14.** What the gate found:

- **Every page's flow in both languages:** one Playwright script ran on the
  Node and the Go servers alike, each from an empty database: claiming the
  first account, a team, a provider from the catalogue and two models,
  a plugin, a preset from a template, a member and a reset password, the
  team switcher, every team page in Chinese, the account page, a team that
  does not exist, a phone-width overview and signing out. A second script
  ran the invitation flow on an instance that sends email: codes through a
  stand-in mail server, an invitation link, the invitee signing in through
  it and joining. Neither met a page error.
- **Screenshots side by side:** the 27 pages and states the two servers
  share, the home page in both languages among them, match apart from the
  server's own address. Signing out on the Go console went to the sign-in
  page where the Node app went home; it now goes home.
- **Tests:** the SEO, AI-crawler, canonical-host, browser analytics and
  legal-document tests are ported, with the choice of home page by
  profile, cookie and browser, on top of phase 2's.
- **The review** found nine things, all fixed:
  - the console read the cookie and the browser but never the profile's
    language, so a person whose profile said Chinese saw the home page in
    Chinese and the console in English; the server now writes the viewer's
    language on the console's page, as it chooses the home page;
  - choosing a language wrote the profile from a session whose admin-set
    password was unchanged;
  - publishing several models that failed part-way left the page showing
    none of those published, and a retry collided with them on every try
    (the Node console too); the page now reads its data again after every
    write;
  - a sign-out that failed said nothing;
  - two reads of one list answering out of order could bring back a
    deleted entry;
  - `/account` was outside the must-change guard;
  - the home page's `Vary` left out `Authorization`, and the console's had
    none;
  - the www/apex redirect carried no security headers, HSTS included;
  - a q such as `inf` in Accept-Language ranked differently from the Node
    parser.

### Phase 4: packaging, self-hosting and CI

- The npm packages under the rules below, release binaries for the five
  platforms, and a container image.
- `compose.yaml` on the image, the README's self-hosting section, and the
  first-start flow of ADR 0006 on the binary.
- CI: the Go tests on the three dialects, the drift check per dialect, the
  console build, the plugin end-to-end test, and an `npx` smoke test on
  macOS, Windows and Linux. The pre-push gate runs the same set.

**Verified by:** CI green on all of it, and one install from a clean machine
on each platform with `npx`, the release binary and `compose.yaml`.

**Done on 2026-11-14.** What the gate found:

- **Where it lives:** `server/` is a workspace package, so the gate's `lint`
  (gofmt and vet), `test`, `build` and `db:drift` run the Go side with the
  rest, and the pre-push hook adds the plugin's end-to-end test when the
  plugin is checked out beside. The server's build copies the built console
  in (`server/scripts/embed.mjs`) and turbo keeps the copy as its output, so
  a cache hit compiles too. `server/scripts/pack.mjs` builds the five
  binaries and their packages; `server/npm/launcher.js` is the launcher.
- **CI on a clean runner:** the Go suites on SQLite, Postgres 16 and
  MySQL 8.4, the drift check on all three, the plugin's end-to-end test on
  all three, the release packed and installed with `npx` from an empty cache
  through a registry on the runner on Linux, macOS and Windows, and
  `compose.yaml` built from `server/Dockerfile`, answering with no `.env`,
  printing the setup link, and printing the same one after the container was
  replaced, so the SQLite file and `secrets.json` live in the volume. The
  binary the npm package installs is the one the release offers for download.
- **Found on the runners:** `npm publish dir/name.tgz` reads a path with a
  slash as a GitHub repository on Linux and macOS (not on Windows); the
  smoke test and the release publish by explicit path.
- **Not run:** a tag, which publishes for real, waits for an `NPM_TOKEN` and
  the developer's go-ahead; the first release is its own check.
- **The review** found ten things; nine are fixed:
  - `go vet` and a cached console build ran without the console in
    `internal/web/dist`, which is not in git, so a fresh checkout could not
    compile it; the server's own build now copies it, and lint and test wait
    for that build rather than racing it;
  - a `HOST` in compose's `.env` overrode the container's address, and a
    changed `PORT` left `APP_URL` on 3000;
  - the launcher re-raised a child's signal into its own handlers and exited
    0;
  - a tag on a commit CI never saw would publish; a release now requires the
    commit to be on `main`;
  - the arm64 image built the console and the binary under emulation; both
    stages now run on the builder's platform and Go cross-compiles;
  - the second test run (PGlite) ran the Go suites again;
  - the plugin's path in the pre-push hook was relative to the wrong
    directory;
  - and this document was not updated.

  The tenth, that the plugin repository might be private to CI's token, did
  not hold: it is public.

### Phase 5: `premium/`

- The operator console and `/api/admin/*`: Google only, `ADMIN_EMAILS` re-read
  on every request, `MANAGE_API_KEY` with `x-agent-id`, the self-describing
  index.
- The closed binary built with `premium/server/`, and the edition boundary
  check kept.
- The hosted service moved to the closed binary on Railway.

**Verified by:** today's console tests rewritten in Go; the route index held
to the routes by a test; the hosted service answering the plugin end-to-end
test after the move.

### Phase 6: delete the Node server

- `apps/web`, `packages/db`, the server half of `packages/shared`, Prisma,
  Auth.js and Next.js, and the parity run, which has nothing left to compare.
- `CLAUDE.md`, `docs/tech/architecture.md`, `docs/tech/community-edition.md`,
  the README and the changelog rewritten for the Go server.

**Verified by:** the gate and the plugin end-to-end test passing with the
Node server gone, and `pnpm lint:docs` over the rewritten documents.

### After phase 6: Feishu

Feishu sign-in, through goth's `lark` provider, as ADR 0014 decided, with
linking a second sign-in from the account page. Moved after the Node server
is gone by the developer's choice on 2026-11-14: Google comes first.

**Verified by:** Feishu against a stub OAuth server in tests, and once by
hand against a real Feishu app.

## Decisions

Taken by the developer on 2026-11-14:

- **The public pages are prerendered.** Home, privacy and terms are rendered
  to static HTML when the console is built, and embedded with it.
- **The hosted service starts empty on the Go server.** Its data is not
  carried over.
- **The parity run belongs to each phase's gate**, not to CI.
- **Google before Feishu.** Phase 2 brings Google; Feishu follows phase 6.

## Experiment 1: three dialects from one schema

Run on 2026-11-13 with ent 0.14.6, Atlas 1.3.0, `modernc.org/sqlite`
1.62.0, pgx 5.13.0 and `go-sql-driver/mysql` 1.10.1, against SQLite,
Postgres 16.15 and MySQL 8.0.46. Today's tables plus `identities`.

**Every check passed on all three:**

- one ent schema generated a migration per dialect, and generating again
  against the replayed history produced nothing, so drift can be checked per
  dialect;
- the test applied the migration files itself, statement by statement, with
  no Atlas CLI, as the binary will at start;
- under a burst of 50 concurrent requests:
  - a code spent exactly 5 checks;
  - an address got exactly 5 codes;
  - a password spent exactly 10 guesses;
- `Foo` and `foo` were two names, and a second `Foo` was a constraint error;
- JSON came back as it was written;
- `(provider, subject)` was unique, and a user with an identity could not be
  deleted;
- a time in 2100 with microseconds came back equal.

**Two controls showed the checks can fail:**

- MySQL's default collation refused `foo` beside `Foo`.
- A limit written as "count, then insert" sent 15, 18 and 45 codes against a
  limit of 5.

**Size:** the data layer alone, built without cgo, is 23–25 MB on Linux,
macOS and Windows; most of it is the SQLite driver.

## Experiment 2: the gateway

Run on 2026-11-13. The Go gateway did what `llm-gateway.ts` does, over the
ent schema of experiment 1 on Postgres 16: the Bearer, the user, the
configuration, the membership, the provider and its sealed key, the
allow-list, and the stream copied with none of the upstream headers. Its
address check was a stand-in that admits loopback literals; the real rule,
checked inside the connection's own lookup, is ported with the gateway. The
Node gateway was `next start` of today's `apps/web`, on its own Postgres
database with the same rows. A stub provider answered both: JSON after
50 ms, or a stream of 100 chunks 10 ms apart. Both gateways, the stub and the
load generator shared one 4-core machine.

**Parity: the same on every check.**

- The answers were byte for byte the same, streamed (10,614 bytes) and not.
- The provider received the same body from both: the allow-listed fields,
  `max_tokens` set from the model, and `user` and `base_url` dropped.
- The status and error code matched for no token, a model of another team,
  and a `max_tokens` above the model's.
- **The Go gateway accepted a plugin token minted by the Node server.** An
  Auth.js JWE is `dir` with A256CBC-HS512 under an HKDF of `AUTH_SECRET` and
  its salt, which `go-jose` decrypts. So tokens already issued can keep
  working across the rewrite, and members need not sign in again.

**Load:**

| Case | Concurrency | Node: req/s, p50 / p99 | Go: req/s, p50 / p99 |
| --- | --- | --- | --- |
| JSON, 50 ms upstream | 1 | 16.7, 59 / 65 ms | 18.8, 53 / 56 ms |
| JSON | 50 | 235, 201 / 485 ms | 681, 68 / 120 ms |
| JSON | 200 | 339, 568 / 1,836 ms | 1,710, 113 / 184 ms |
| Stream, first byte | 1 | 8.6 / 11.5 ms | 2.0 / 2.5 ms |
| Stream, first byte | 100 | 139 / 630 ms | 32 / 82 ms |
| Stream, 1.1 s answer | 500 | 152, first byte 1,880 / 3,052 ms | 393, first byte 125 / 294 ms |

- **Memory:** 299 MB idle and up to 742 MB under load for Node; 29 MB idle
  and up to 100 MB for Go.
- **CPU per request** at 200 concurrent JSON calls: 3.5 ms for Node, 0.8 ms
  for Go.
- No request failed in either.

**What it means:** for one team, sending one request at a time, the gateway
adds about 9 ms with Node and 3 ms with Go, which a model's answer dwarfs.
The difference is in what one instance carries: about four to five times
the requests per core, and a tenth of the memory, which is what the hosted
service and a small private server pay for.

## Experiment 3: `npx` and the platform packages

Run on 2026-11-13 against a local registry (Verdaccio 6), so no network time
is in the numbers. The binary embedded a page and the SQLite migrations; its
self-check applied them in a data directory and wrote and read a row. Six
packages were published: `server` (a 1 KB launcher, its `bin`) and one per
platform, each listed in `server`'s `optionalDependencies` with `os` and
`cpu`.

**On Linux x64, everything the plan relies on held:**

- `npx` from an empty cache installed `server` and `server-linux-x64` only,
  and ran the binary in 1.4 s; with the cache warm, 0.46 s.
- Asked for another platform (`npm install --os … --cpu …`), npm chose
  `darwin-arm64`, `darwin-x64`, `win32-x64` and `linux-arm64` correctly, one
  each.
- The binary kept its executable bit through `npm pack` and install, with no
  `bin` entry in the platform package.
- `--ignore-scripts` changed nothing; `--omit=optional` ended in the
  launcher's message and exit code 1.
- `pnpm dlx` worked the same way.
- A second start kept the data and skipped the applied migration.
- The `linux-arm64` binary passed its self-check under qemu.

**Sizes:** each platform package is 9.7 MB to download and 24–26 MB
installed.

**On macOS (arm64) and Windows (x64)**, GitHub's runners ran the same
packages from a registry on the runner, with npm and `pnpm dlx`: version,
self-check twice, the page served, one platform package installed, and the
message when optional dependencies are omitted. All passed once the two
problems below were fixed. From an empty cache, `npx` took 0.54 s on macOS and
5.1 s on Windows; warm, 0.43 s and 0.77 s.

**Two problems the release must handle, found on the runners:**

- **The executable bit is lost on the way to `npm pack`.** Built in one job
  and packed in another, through `actions/upload-artifact`, the Linux and
  macOS binaries arrived without it, and every start ended in `EACCES`. A
  release packs in the job that built the binaries, and checks the modes
  `npm pack --json` reports before it publishes.
- **Windows cannot start a program from a path of 260 characters or more.**
  `pnpm dlx` installs into a directory named by a timestamp and a process id,
  and when the id took four hex digits the binary's path was exactly 260
  characters: `require.resolve` found it and starting it failed with
  `ENOENT`. A long user name or project path does the same. The launcher now
  runs a copy kept under `%LOCALAPPDATA%\dsh-teamwork\<version>\` when the
  path is that long; a test installed into a path of 270 characters and ran.

**Two more findings:**

- **A registry's upload limit can refuse a platform package.** Verdaccio's
  default, 10 MB, did. A company that mirrors npm through its own registry
  may need the limit raised, so the release binaries and the container image
  stay a documented way in.
- **`npx` is for starting it, not for running it as a service.** Ctrl-C
  reached the whole process group and everything stopped, and a SIGTERM to
  the launcher reached the binary. A SIGTERM to `npx` alone, which is what a
  service manager sends, ended npm but left the launcher and the binary
  running: npm does not pass it on. A service runs the binary itself.

## Rules for packaging

- One package per platform, chosen by `os` and `cpu` in the launcher's
  `optionalDependencies`; no `postinstall`.
- The Linux and macOS binaries are packed with their executable bit, checked
  in the tarball before publishing.
- On Windows the launcher starts a short-path copy when the installed path is
  260 characters or longer.
- A service starts the binary itself, never through `npx`.

## Rules for the data layer

- **A limit is a conditional update**: `UPDATE … SET n = n + 1 WHERE … AND
  n < limit`, and the request proceeds only when one row changed. A window is
  reset by a second conditional update on its start time. No advisory lock,
  no count-then-insert.
- **Every MySQL table is `utf8mb4` with `utf8mb4_bin`**, set once in the
  shared mixin.
- **Every time column is `datetime(6)` on MySQL.** ent's default,
  `timestamp`, ends in 2038 and drops microseconds.
- **SQLite opens with** `foreign_keys(1)`, `busy_timeout(10000)`,
  `journal_mode(WAL)` and `_txlock=immediate`. With these, twenty
  connections writing at once raised no error.
- **Ids are a Go nanoid**, set by the application.

## How done is verified

- Every database suite runs on SQLite, Postgres 16 and MySQL 8 in CI, and the
  drift check runs per dialect.
- The plugin, unchanged, signs in, syncs and calls a model through the binary.
- Tests pin the boundaries the Node server pins today: the limits under a
  burst, a provider key never in a response, the provider address rule, a
  team the caller is not in answering 404, and the PKCE exchange.
