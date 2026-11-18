# 0050. Every call needs a rate

> **Status:** Accepted · **Date:** 2026-11-18

## Context

A team model's reference rate (ADR 0022) was optional. The gateway refused a
model without one only where a points budget applied
(`budget_model_unpriced`); anywhere else the call went through and was
recorded `unpriced`, with no points. A team that set no budget therefore
never learned what its members spent, and every such call joined the calls
an admin was asked to resolve one by one, though no allowance was at stake.

A rate belongs to the provider and upstream model it was set for, so pointing
a model at another upstream model left it unpriced in the same way, silently.

## Decision

- **Admission refuses a call on a model without a rate** for the provider and
  upstream model it calls now, budget or none: `403 model_unpriced`, before
  any hold or upstream request, and with no usage row. It replaces
  `budget_model_unpriced`. A model an edition funds is priced by its quote
  (ADR 0024) and is unaffected.
- **An explicit zero rate is a rate.** A team that wants calls counted but
  not weighed sets zero.
- **The admin is told where calls stop.** `GET …/summary?scope=team` lists
  `unpricedModels`, by the same rule admission applies; the team overview
  puts them first among what waits, getting started counts a model as ready
  only once it is priced, and the models page marks each one.

## Consequences

- Every new call's points are known, so usage and budgets agree whether or
  not a cap is set, and resolving by hand is left to what is genuinely
  uncertain: responses whose usage never arrived, and measured overruns.
- A new team takes one more step before members can call a model; the rate
  dialog's fill from public prices keeps it short.
- Changing a model's upstream model stops its calls until a rate is set for
  the new one, rather than letting them through unweighed.
- The `unpriced` state, its window counters and the quota's `unconfirmed`
  answer remain for rows written before this; no new call reaches them.
- Rejected: requiring a rate in the same request that publishes a model,
  which would fold two revisioned records into one write; and hiding unpriced
  models from members' DSHs, which would make a model vanish on a pricing
  change instead of saying why it cannot be called.
