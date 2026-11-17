# 0042. A work-first team console

> **Status:** Accepted · **Date:** 2026-11-17

## Context

A team's console (`/teams/{teamId}`) was built for its admin: models, presets,
plugins, sharing, history, members, usage and budgets, with a member seeing a
read-only copy of most of them. The direction (ADR 0003) puts work a member does
inside the team — starting cloud sessions first — behind that same entry, and
an edition's work page (a member's cloud sessions) listed among the admin's
pages, or beside them for everyone, says the console is for running the team
when for most of the people who open it, it is where they work.

ADR 0028 let an edition add a page to the sidebar, the same list for every
member of every team, from the session.

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

An edition registers a page with an `Audience` (`work` or `admin`) and, if it
applies to some teams only, a `Visible` function given the team and the reader.
`GET /api/teams/{teamId}` returns the pages that reader sees in that team
(`Team.pages`), so the list is per team; the session keeps only the prefixes
(`Session.editionPaths`) a sign-in return needs. `GET …/submissions?mine=true`
narrows the list to the caller's own.

## Consequences

- A member no longer sees usage, budgets, history or the plugins and models
  pages: what they need from those is in Team resources and Home, and the team
  assistant still answers about their usage and budgets through the API.
- An edition page can follow a per-team switch (the hosted trial of cloud
  sessions) without the open console knowing about it, at the cost of a
  callback per page each time a team is read.
- Leaving a team moves from the members page, now the admin's, to the team
  switcher.
- Supersedes ADR 0028: the path rules and the sign-in return it set stay; the
  session's list of pages does not.
