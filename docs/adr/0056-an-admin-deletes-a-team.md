# 0056. An admin deletes a team

> **Status:** Accepted · **Date:** 2026-11-19

## Context

A team could only end with its admin's account (ADR 0039), and only once
everyone else had been removed or handed the role. An admin who wanted to wind
a team down had to empty it member by member and then delete their own account
with it, losing every other team they were in.

## Decision

`DELETE /api/teams/{teamId}`, by the team's admin, with the team's name typed
back as `confirm` (exactly, apart from surrounding spaces). In one
transaction the team goes with every membership and every row that names it,
the same set an account's lone team loses (configs, providers, invitations,
submissions, history, artifacts, usage, budgets, pages); stored bytes are
removed after the commit. An edition hears `TeamDeleted` inside it, as for an
account's lone team, and may refuse: the hosted edition refuses while the team
holds purchased credit or a payment still open (`wallet_has_balance`), and
forgets its cloud computers, shared DSHs and admissions. Accounts stay, and so
do their other teams.

The console offers it at the foot of Members, which only the admin opens.

## Consequences

Deleting a team is immediate and cannot be undone, for everyone in it: no
member is asked, and they learn when it disappears from their console and
from their DSH at the next sync. A member's usage in it goes too, as it does
with an account's lone team. There is still no soft delete, no archive and no
transfer of a team's contents to another team.
