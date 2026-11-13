# 0013. A person may be in several teams

> **Status:** Accepted · **Date:** 2026-11-13

## Context

A membership was keyed by the user alone, so a person was in at most one team.
The URL `/team`, every `/api/team/*` route and the plugin's snapshot relied on
that: the server knew the team from the person. People do not work that way. A
consultant serves two clients, an engineer runs a side project's team as well
as their employer's, and an admin of one team is invited into another. Each
such person had to keep a second account. The community edition is the same
product for one team, so this is not a company feature for the closed edition.

## Decision

A membership is keyed by the pair, user and team, in both editions. The team
travels in the request: the console is `/teams/{teamId}/…` and the API
`/api/teams/{teamId}/…`. Every rule in `apps/web/src/lib/team.ts` reads the
membership of exactly that pair, and acts on that team only: a team the caller
is not in is `404 team_not_found`, the same answer as one that does not exist;
an admin check is the role in that row and never another of the person's teams.

The plugin syncs every team the person is in from `GET /api/configs`
(`{ teams: [{ teamId, teamName, role, configs }] }`). It registers each team's
entries as `team:<teamId>:<configId>`, named `[<team name>] <name>`, and a
preset's model and plugin pins resolve within its own team only. The gateway
finds the team a configuration id belongs to, checks the caller's membership in
that team, and calls that team's provider with that team's key.

## Consequences

- A person needs one account for every team, and one plugin sign-in for all of
  them. Who pays for a call is decided by the configuration it names.
- Every team route carries an id and every rule checks the pair; forgetting the
  check in a new route would let an admin of one team act on another. The
  suite in `apps/web/src/lib/__tests__/team.test.ts` pins the 404 and the
  pairing.
- The snapshot's shape changed, so plugin 0.7.0 and this server ship together;
  plugin 0.6 still asks for `/api/team/configs`, gets a 404 and stops syncing
  until it is upgraded. No route
  for the old shape is kept.
- The URL `/team` is gone; invitation links are `/teams?invite=…`.
- A team keeps at least one admin, as before: the admin cannot leave.
- A password opens the whole account, so an admin resets it only for a member
  who is in no other team; anyone else changes their own.
