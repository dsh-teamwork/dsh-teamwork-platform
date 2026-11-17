# 0039. Deleting an account

> **Status:** Accepted · **Date:** 2026-11-17

## Context

The privacy policy promised deletion by email only, and Google Play and the
App Store want it in the product. Every team has exactly one admin, and there
was no way to hand that role over or to delete a team, so deleting the admin
would either orphan a team other people depend on or silently take it from
them. A hosted team may also hold credit somebody paid for.

## Decision

`DELETE /api/profile`, from a browser session only, with the account's email
typed back as `confirm`. In one transaction:

- An account that administers a team with anyone else in it is refused
  (`admin_of_shared_team`). The admin hands the role over first with
  `POST /api/teams/{teamId}/members/{userId}/admin`, which swaps the two
  roles, so a team still has one admin.
- A team the account is alone in is deleted with every row that names it:
  configs, providers, invitations, submissions, history, artifacts, usage,
  budgets. Artifact bytes are removed after the commit; a failure there is
  logged, since nothing reaches them any more.
- Elsewhere, only the membership goes. Usage, published versions and review
  decisions stay with their team and read as a former member.
- The account row goes, and its identities and password with it. An existing
  session or plugin token opens nothing once the row is gone.

An edition hears `TeamDeleted` for each team and then `AccountDeleted` through
`Host.SubscribeTeams` (ADR 0026), inside the transaction, and may refuse with
an error: the hosted edition refuses while a team to be deleted holds
purchased credit (`wallet_has_balance`), and removes the account's relay hosts
and phone pairings.

## Consequences

Deleting is immediate and cannot be undone; there is no grace period or
soft-delete column to sweep later. The same address can sign up again as a new
account with nothing of the old one. A team's records keep the deleted
person's id with no account behind it, which the console already shows as a
former member. Analytics events already sent under the account's id are not
recalled by this route. Handing over admin is the only role change: there is
still exactly one admin per team, and no co-admins.
