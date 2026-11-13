# Go server

> **Status:** Plan — experiment 1 done · **Updated:** 2026-11-13

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

1. **Experiments, thrown away afterwards.** Each could change ADR 0014.
   1. Three dialects from one schema. **Done**, see below.
   2. The gateway: streaming parity with the Node gateway on the same
      requests, and latency and memory on one fixture.
   3. Packaging: a binary published to a scratch npm scope and run with
      `npx` on Linux, macOS and Windows.
2. **One vertical slice**, against an unchanged plugin: a password sign-in,
   `/teamwork login`, `GET /api/configs`, one call through the gateway.
3. **The team API and the console**, page by page.
4. **`premium/`**: the operator console and `/api/admin/*`.
5. **Deletion**: the Node server, `packages/db`, the server half of
   `packages/shared`, and the parts of `CLAUDE.md` that describe them.

Step 2 gates the rest: until it passes against the real plugin, nothing else
is ported.

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
