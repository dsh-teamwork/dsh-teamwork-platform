# Documentation

Start with [architecture](tech/architecture.md), then the
[community edition split](tech/community-edition.md).
How documents are laid out, named and kept is the "Documentation" section of
[`CLAUDE.md`](../CLAUDE.md).

## Visual system

- [Design](design.md) — the brand mark, colour, type, spacing and icons, and which file owns each.
- [Brand source](brand/icon.svg) — the one hand-edited artwork every icon and logo is exported from.

## Technical

- [Architecture](tech/architecture.md) — components, data model, the team API, both sign-in flows and the model gateway.
- [Community edition split](tech/community-edition.md) — how the open part becomes its own repository, runs from `npx`, and stays in step.
- [Go server](tech/go-server.md) — how the server becomes one Go binary, and what each experiment found.

## Decisions

- [ADRs](adr/README.md) — one file per decision the product makes about itself.

## Operations

- [Analytics](ops/analytics.md) — what reaches PostHog, under which identity, and how to query it.
