# 0036. An edition registers its own meters with the public budget engine

> **Status:** Accepted · **Date:** 2026-11-17

## Context

The hosted edition is adding cloud computers: sandbox VMs whose running time
and stored snapshots cost money and are paid from the team's prepaid wallet.
The developer decided that this compute must count against the same team and
member point budgets as model calls, so that a member's cap bounds everything
the member spends.

The budget engine is public (ADR 0021, ADR 0023): points, windows,
reservations, settlement, recovery, reports and alerts. It knew one kind of
usage, a model call through the gateway, priced in tokens. A closed edition
may not edit public code (`docs/tech/community-edition.md`), and ADR 0021
rules out a second budget engine. The alternatives were:

- **Charge compute to the wallet only.** No public change, but a member's
  budget would not bound it, and Usage and Budgets would not show it.
- **Teach the public engine about cloud computers.** It would name a closed
  product, and its prices, in community code.
- **Let an edition register kinds of usage it defines and prices itself.**

## Decision

**An edition registers meters, and the public engine holds and settles their
points in the same windows, reservations and transaction as model calls.**

- `edition.Host.RegisterMeters` takes the edition's meters (a name, a unit,
  and labels for the name and the unit in each locale) and a `MeterFunding`,
  and returns a `MeterHost` scoped to that edition: `Reserve` and `Settle`.
- **The edition prices its own usage.** `Reserve` holds a number of points,
  and `Settle` reports the measured quantity and the points it costs. The
  engine never sees a price per unit.
- **A meter row is a usage row** (`usage_requests`), with `meter` naming it and
  `quantity` counting its unit; it has no config, provider, model or tokens.
  One table keeps one path through budgets, reports, exports and recovery.
- **Team and member point policies apply; provider policies and token limits
  do not**, because a meter belongs to no model provider and counts no tokens.
- **Funding moves in the public transaction**, as ADR 0024 set for models:
  `ReserveMeter` and `SettleMeter` take the borrowed executor, do no network
  I/O, and a refusal rolls back the hold.
- **A hold past its time is marked lost, never released**, as a lost model
  call is: it stays reserved until the edition settles it. Only the edition
  that owns a meter settles its rows; an administrator cannot estimate them.
- **The engine checks budgets, not access.** The edition decides that the
  member may use what it meters before it reserves.

## Consequences

- A member's and a team's point budget bound model calls and an edition's
  compute together; Usage and its export show metered rows by their labels.
- A community instance registers no meter and behaves as before.
- The public code carries an extension point whose only real consumer is
  closed. Its behaviour is pinned by public tests with a probe extension on
  every database.
- A meter's prices, wallet entries and the decision of when to hold and settle
  stay with the edition. Its hold length is at most 24 hours; longer work is
  held period by period.
- Ruled out: a separate compute ledger, a public price for an edition's
  product, and estimating a metered row by hand.
