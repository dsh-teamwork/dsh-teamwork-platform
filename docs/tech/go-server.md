# Go server

> **Status:** Plan — experiments 1 and 2 done · **Updated:** 2026-11-13

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
      requests, and latency and memory on one fixture. **Done**, see below.
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
