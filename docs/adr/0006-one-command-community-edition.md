# 0006. The community edition runs from one command, with nothing else to install

> **Status:** Accepted · **Date:** 2026-11-11

## Context

ADR 0005 made the community edition self-hostable, and Phase 1 of
`docs/tech/community-edition.md` delivered that as `docker compose up`. That
still asks a team for four things before anyone signs in:

- Docker;
- Postgres;
- an SMTP account, because the only sign-in without Google is an emailed code;
- an operator who writes provider routes and keys into `LLM_ROUTES_JSON`.

The developer wants the community edition to be the cheapest way to start:
one `npx` command on a machine that has Node, and nothing else.

A throwaway experiment on 2026-11-11 measured the database part. It ran the
real migrations and the test suites that need a database against PGlite, an
embedded Postgres compiled to WebAssembly.

- **PGlite in-process passes everything**, through the community
  `pglite-prisma-adapter`. That includes the concurrent sign-in-code tests,
  which hold the attempt limit under an advisory lock. The migrations apply
  unchanged, including `pgcrypto` and the PL/pgSQL `nanoid()`.
- **PGlite behind its socket server fails** those concurrent tests
  (`unnamed prepared statement does not exist`). That holds with one
  connection or with ten.
- **Data survives a restart and a SIGKILL.** All 7,055 commits acknowledged
  before the kill were still there afterwards. A power loss was not tested.
- **It is about a third as fast as Postgres 16.** On the same script:
  - 705–742 reads/s against 2,065;
  - 473–509 transactional writes/s against 1,600;
  - about 500 MiB for the whole process.

  That is far above what one team sends.
- **PGlite is alpha.** It is licensed Apache-2.0 or the PostgreSQL License,
  at the user's choice. The adapter is MIT, maintained by one person, and
  built against Prisma 7.2.

## Decision

**With no configuration, the community edition depends on no other service.**
Each external service becomes something a deployment adds, never something
it needs:

- **The database.** With no `DATABASE_URL`, the web app runs PGlite
  in-process, in a data directory. With one, it uses Postgres as today. The
  schema, the migration history and every query stay Postgres; there is no
  second dialect. `compose.yaml` and the hosted service keep Postgres.
- **Sign-in.**
  - With `SMTP_URL`, sign-in is an emailed code, as today.
  - Without it, sign-in is an email and a password.
  - Google stays optional either way. Both doors keep one account per
    lower-cased email.
  - A team admin creates a member's account with a generated first password,
    shown once. It must be changed at first sign-in, and only an admin resets
    it.
  - The first account on a new instance is claimed with a one-time setup
    link, printed by the server at start.
- **Providers belong to teams.** A team admin enters each provider's address
  and key in `/team`. The key is encrypted in the database (AES-256-GCM,
  bound to its team and provider name) and never returned to a browser.
  `LLM_ROUTES_JSON` is deleted. The hosted service becomes bring-your-own-key:
  a team pays its own providers.
- **The plugin accepts plain HTTP to private addresses**, as the gateway
  already does for providers, and warns when it does. A team on one network
  then needs no certificate.
- **It is published as `@dsh-teamwork/server`** and started with
  `npx @dsh-teamwork/server`. The server writes its own `AUTH_SECRET` and
  encryption key into the data directory on first start.

## Consequences

- **The cheapest start is one command**, which is the point. Docker, Postgres
  and SMTP become upgrades a team makes when it needs them.
- **The default database is alpha software, holding the team's own data.**
  - The data directory is the backup. It is copied while the server is
    stopped, or dumped with `pg_dump` through PGlite's socket server.
  - A team that outgrows it moves to Postgres with that dump.
  - Moving is the documented path, not a migration tool.
- **One process owns the data directory.** The PGlite path cannot scale
  horizontally. It must close PGlite on shutdown, because the Prisma client's
  disconnect does not.
- **Every suite that needs a database runs twice in CI**, on PGlite and on
  Postgres. The adapter is pinned to an exact version and moves only with a
  run of both.
- **Two first-run flows exist, decided by `SMTP_URL`.**
  - With email, people join by single-use invite links.
  - With passwords, an admin creates their accounts.
- **A password is a credential the server now holds.**
  - It is stored as scrypt from `node:crypto`, so no dependency is added.
  - Guesses are limited per address the way sign-in codes are.
  - Changing a password does not end sessions or plugin tokens already
    issued: JWTs still cannot be revoked (ADR 0001). Team access is still
    re-checked on every request.
- **Provider keys move from the deployment's environment into the database.**
  - The key that encrypts them is the instance's `PROVIDER_KEYS_SECRET`.
    `npx` generates it; the hosted service sets it.
  - Losing it loses every stored provider key, never anything else.
- **A provider address now comes from a user, not from the operator.** On a
  shared instance that is server-side request forgery against the host's own
  network. So:
  - addresses on loopback and private networks are allowed only where the
    instance opts in (`ALLOW_PRIVATE_PROVIDERS`). `npx` and `compose.yaml`
    opt in; the hosted service does not.
  - Wherever they are refused, the gateway connects to the address it
    checked, so a DNS answer cannot change between the check and the call.
- **A plugin token crosses a private network in clear text** when a team
  chooses plain HTTP. The plugin warns. `https://` is still required for
  any public address.
- **Ruled out:**
  - **SQLite.** A second Prisma schema, a second migration history and a
    second copy of every raw query, kept for as long as the open edition is
    maintained.
  - **PGlite behind its socket server**, which fails concurrent transactions.
  - **A first account claimed by whoever opens the page first**, which
    anyone else on the network could win.
  - **Instance-wide providers with an instance owner**, which would need a
    role the open edition does not have.
