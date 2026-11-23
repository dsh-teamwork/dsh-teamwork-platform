# 0047. A host token signs a shared DSH in for one team, as no person

> **Status:** Superseded by 0067 · **Date:** 2026-11-17

## Context

An edition lets a team share one DSH it runs itself: members reach it from
their phones and browsers, and its model calls are billed to the team. That
DSH must sync its team's configuration and call its team's models through the
gateway, but it belongs to no member. Signing its plugin in as a person would
make that person's account, teams and budgets the DSH's, and a member's plugin
token (ADR 0001) reaches every team the member is in for a month. A computer
token (ADR 0038) is narrow enough, but it names a member: its calls are that
member's, and they stop when that member leaves.

## Decision

**A host token is a sealed value of its own kind for one shared host of one
team, with no person in it, accepted by two routes only.**

- **Its own purpose and key** (`auth.HostBearer`): it never opens as a
  plugin token, a session or a computer token, and they never open as it. Its
  subject is the shared host's id, which the edition owns.
- **One team, at most an hour.** The DSH renews it through the edition, which
  checks the shared host is still the team's and not revoked before minting.
- **Two routes accept it:** `GET /api/configs`, which returns that team alone
  with role `member`, and the model gateway, which refuses any other team's
  model. Every other route calls `requireUser`, which does not open it.
- **No membership is checked, because there is none.** The team is the bound:
  a deleted team's host syncs nothing and calls nothing.
- **Its calls are the team's.** A usage row records `host_id` and an empty
  `user_id`; the team's and providers' budgets hold it, and no member's or
  default member's does. The console's usage list names it as a shared DSH.
- **Only an edition mints it**, through `edition.Host.MintHostToken`.

## Consequences

- Removing a member never stops a shared DSH; revoking its host in the
  edition does, within the hour the last token lives, and at once wherever the
  edition checks the host itself (its relay does).
- A team that wants to cap a shared DSH caps the team. A budget per shared
  host is not built; it would be a new budget scope.
- An agent that reads the token on that machine can sync the team's
  configuration and call its models for at most an hour, which the DSH can do
  anyway.
- `usage_requests` gains a column, in one migration per dialect.
- Ruled out: a shared DSH signed in as a person, a host token that reaches
  more than one team, and a host token on any route but these two.
