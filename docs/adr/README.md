# Architecture decision records

The index of this product's decisions, one file each: `NNNN-short-title.md`,
numbered in order, never renumbered. A new record starts from the template
below and gets a line here. A missing number is a decision about the business
or the hosted service, kept with the closed edition rather than here.

- [0001](0001-plugin-sign-in.md) — the DSH plugin signs in through the website with a pasted PKCE code.
- [0002](0002-platform-from-seed.md) — the platform is rebuilt from seed: one Next.js app on Railway.
- [0005](0005-open-core.md) — open core: a self-hosted community edition for one team; company features stay closed.
- [0006](0006-one-command-community-edition.md) — the community edition runs from one `npx` command: PGlite, passwords, team-owned provider keys.
- [0007](0007-one-domain-one-app.md) — the web app serves the root domain and the landing page; legal pages come from `LEGAL_DIR`.
- [0010](0010-the-app-gets-its-code-back.md) — a phone app gets its sign-in code back by redirect, after the same confirmation.

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
