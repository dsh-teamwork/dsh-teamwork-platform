# 0070. The first visitor sets up the instance

> **Status:** Accepted · **Date:** 2026-11-26

## Context

On an instance with passwords (no `SMTP_URL`), the first account was claimed
at `/setup?token=…`, a link derived from `AUTH_SECRET` and printed only in the
server's output. [ADR 0006](0006-one-command-community-edition.md) chose that
and ruled out "a first account claimed by whoever opens the page first, which
anyone else on the network could win".

In practice the person who deploys an instance opens it next, to set it up,
and the sign-in page then told them to go and find a line in the server's
log: in `docker compose logs`, a PaaS log viewer, or turbo's task pane during
development. Every first run started with a search through output for a
token.

## Decision

- **While no account has a password, setup is open to whoever arrives.**
  `POST /api/auth/setup` takes an email and a password and no token. The
  claim stays one unique `rate_windows` row written in the same transaction
  as the account, so a race yields one account on every dialect, and setup
  is closed (`setup_closed`) for everybody afterwards.
- **The sign-in page shows nothing else.** With `setupOpen` and the password
  door, it replaces the sign-in form with one call to action that leads to
  `/setup`.
- **The server's start line names `APP_URL/setup`** and carries no secret.
- **A management process still neither offers nor accepts setup**
  (`SERVICE_ROLE=manage`).
- `SetupToken` and the `setup_link_invalid` error code are deleted.

## Consequences

- **The window between start and setup is open.** An instance reachable by
  others before its deployer finishes setup can be claimed by someone else,
  who then holds the first account. A deployer who cannot accept that keeps
  the instance off the network (bind to loopback, or keep it behind the proxy)
  until setup is done. A claimed instance is recovered by resetting its
  database, which is cheap only before members join.
- Setup needs no access to the server's output, so a deployment that hides
  its logs from the person doing setup works too.
- An instance with `SMTP_URL` is unaffected: it has no setup step, and email
  codes sign anyone in.
- Ruled out: **showing the token only in development** (`DEV_VITE`), which
  kept the log search for every real deployment, the case it was meant for;
  and **showing the tokenised link on the page**, which keeps a secret that
  protects nothing.
