# Architecture decision records

The index of this product's decisions, one file each: `NNNN-short-title.md`,
numbered in order, never renumbered. A new record starts from the template
below and gets a line here. A missing number is a decision about the business
or the hosted service, kept with the closed edition rather than here.

- [0001](0001-plugin-sign-in.md) — the DSH plugin signs in through the website with a pasted PKCE code.
- [0002](0002-platform-from-seed.md) — the platform is rebuilt from seed: one Next.js app on Railway.
- [0005](0005-open-core.md) — open core: a self-hosted community edition for one team; company features stay closed.
- [0006](0006-one-command-community-edition.md) — superseded by 0014: the community edition runs from one `npx` command: PGlite, passwords, team-owned provider keys.
- [0007](0007-one-domain-one-app.md) — the web app serves the root domain and the landing page; legal pages come from `LEGAL_DIR`.
- [0010](0010-the-app-gets-its-code-back.md) — a phone app gets its sign-in code back by redirect, after the same confirmation.
- [0012](0012-the-plugin-gets-its-code-back-on-loopback.md) — the DSH plugin gets its sign-in code back on a loopback address.
- [0013](0013-one-person-many-teams.md) — a person may be in several teams; the team travels in the URL.
- [0014](0014-one-go-binary.md) — the server becomes one Go binary over SQLite, Postgres or MySQL.
- [0021](0021-community-usage-and-budgets.md) — usage points and budgets are community features; hosted wallets and payment settlement stay closed.
- [0022](0022-reference-usage-accounting.md) — exact reference points, immutable rates and per-call usage snapshots; incomplete usage remains pending.
- [0023](0023-community-budget-reservations.md) — atomic scope reservations, calendar windows, explicit recovery and transactional budget notifications.
- [0024](0024-atomic-model-funding.md) — protected model routes and optional funding share the public accounting transaction.
- [0026](0026-transactional-team-events.md) — edition provisioning joins real team creation and member insertion transactions.
- [0028](0028-edition-team-navigation.md) — superseded by 0041: registered same-origin team pages linked from the console.

- [0032 — Shared instance management](0032-shared-instance-management.md) — community administration and isolated service roles.
- [0033 — Private artifact storage providers](0033-private-artifact-storage-providers.md) — local defaults, private S3 storage and verified migration.
- [0034 — Team-scoped artifact paths](0034-team-scoped-artifact-paths.md) — per-team object keys, verified migration and retained flat sources.
- [0035 — The fluke rises from a layered sea](0035-the-fluke-rises-from-a-layered-sea.md) — the brand mark's sea, its colours and the versions turned down.
- [0036 — Edition meters](0036-edition-meters.md) — an edition's own usage, priced by it, counts against the public point budgets.
- [0038 — Computer tokens](0038-computer-tokens.md) — a cloud computer's plugin token reaches one team's configuration and models, for an hour.
- [0039 — Deleting an account](0039-deleting-an-account.md) — self-service deletion, admin handover first, lone teams deleted with it.
- [0040 — The app deletes the account](0040-the-app-deletes-the-account.md) — the phone app's token deletes the account too, with the email typed back.
- [0041 — An edition composes the web app](0041-an-edition-composes-the-web-app.md) — `mountWeb` and `SetWebConsole`; development served through Go on :3800.
- [0042 — Host tokens](0042-host-tokens.md) — a shared DSH's token reaches one team's configuration and models as no person.
- [0044 — The relay and shared DSHs are open](0044-the-relay-and-shared-dshs-are-open.md) — the relay, shared DSHs and their archive join the community edition.

The template:

```markdown
# NNNN. Title

> **Status:** Accepted · **Date:** 2026-01-31

(Status is Proposed, Accepted or Superseded by NNNN.)

## Context
What forced a decision, and what was true at the time.

## Decision
What was decided, in one paragraph.

## Consequences
What becomes easier, what becomes harder, and what is now ruled out.
```

An accepted record is not edited again except for its status; a changed mind
is a new record. A superseded record stays, with its status pointing at the one
that replaced it: the reasoning of a reversed decision is exactly what the next
reader needs.

- [0029 — Team assistant and inherited models](0029-team-assistant-and-inherited-models.md) — transactional provisioning and an explicit local-model choice.

- [0030 — Reviewed resources and history](0030-reviewed-resources-and-publication-history.md) — approval transactions, private plugin artifacts and immutable recovery.
