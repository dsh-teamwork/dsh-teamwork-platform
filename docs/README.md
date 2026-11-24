# Documentation

Start with [architecture](tech/architecture.md), then the
[community edition split](tech/community-edition.md).
How documents are laid out, named and kept is the "Documentation" section of
[`CLAUDE.md`](../CLAUDE.md).

## Visual system

- [Design](design.md) — the brand mark, colour, type, spacing and icons, and which file owns each.
- [Brand source](brand/icon.svg) — the one hand-edited artwork every icon and logo is exported from.

## Technical

- [System management](tech/system-management.md) — instance administration, service roles, authentication boundaries and edition composition.

- [Architecture](tech/architecture.md) — components, data model, the team API, both sign-in flows and the model gateway.
- [Team assistant](tech/team-assistant.md) — default assistant, reviewed plugin/preset sharing, publication history and recovery.
- [Relay and pairing](tech/relay.md) — how a phone or browser reaches a DSH: pairing, frames, encryption, push.
- [Automation tasks](tech/automation-tasks.md) — managing a computer's DSH Schedule tasks from the web and the phone.
- [Artifacts](tech/artifacts.md) — what agents publish from sessions: storage, sharing, sandboxed viewing and the order of work.
- [Knowledge](tech/knowledge.md) — the team's documents people and agents maintain together, read as context.
- [Usage points and budgets](tech/usage-budgets.md) — community metering, model prices, team/member limits, reservations, reports and implementation acceptance.
- [Community edition split](tech/community-edition.md) — how the open part becomes its own repository, runs from `npx`, and stays in step.
- [Go server](tech/go-server.md) — how the server becomes one Go binary, and what each experiment found.

## Decisions

- [ADRs](adr/README.md) — one file per decision the product makes about itself.

## Operations

- [Self-hosting](ops/self-hosting.md) — install, connect DSH, configure storage, verify and back up the community server.

- [Analytics](ops/analytics.md) — the anonymous page counts PostHog receives, and how to query them.
