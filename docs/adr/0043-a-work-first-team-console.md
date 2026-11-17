# 0043. A work-first team console

> **Status:** Accepted · **Date:** 2026-11-17

## Context

A team's console (`/teams/{teamId}`) was built for its admin: models, presets,
plugins, sharing, history, members, usage and budgets, with a member seeing a
read-only copy of most of them. The direction (ADR 0003) puts work a member
does inside the team — starting cloud sessions first — behind that same
entry. An edition's work page (a member's cloud sessions) listed among the
admin's pages says the console is for running the team, when for most of the
people who open it, it is where they work.

ADR 0041 lets an edition's web app add team pages through `mountWeb`, listed
in one group for everybody in every team.

## Decision

The console is work first. Its sidebar has two groups:

- **Work**, for everyone: Home (`/teams/{teamId}`), Team resources (the
  team's models, presets and plugins, read-only, where a member proposes a
  preset or a change to one), My submissions (`/submissions`, the reader's own)
  and an edition's work pages.
- **Team management**, for the team's admin alone: models, presets, plugins,
  review (`/sharing`), history, members, usage, budgets and an edition's
  management pages. A member who opens one of these is sent home; the API's own
  checks are unchanged.

An edition's team page (`mountWeb`'s `TeamPage`) names its `audience`, `work`
or `admin`, and the group it joins. A page only some teams have gives
`visible(team)`, which the edition's own web app answers from its own API; the
entry is listed once it says yes. The open server knows nothing of either.
`GET …/submissions?mine=true` narrows the list to the caller's own.

## Consequences

- A member no longer sees usage, budgets, history or the plugins and models
  pages: what they need from those is in Team resources and Home, and the team
  assistant still answers about their usage and budgets through the API.
- An edition page can follow a per-team switch (the hosted trial of cloud
  sessions) without the open console or the open API knowing about it, at the
  cost of the edition's own request when a team is shown, and an entry that
  appears once that request answers.
- Leaving a team moves from the members page, now the admin's, to the team
  switcher.
- Rejected: the server deciding visibility through a callback registered by
  the edition and returning the entries with the team, which would bring back
  the server-side page registry ADR 0041 removed.
