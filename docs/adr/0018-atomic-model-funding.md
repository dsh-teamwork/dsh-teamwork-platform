# 0018. Model funding shares the public accounting transaction

> **Status:** Accepted · **Date:** 2026-11-15

## Context

An edition can supply models funded by a prepaid balance. A separate balance
check or transaction permits budget and credit reservations to disagree after
concurrent requests, crashes or failed settlement. Team administrators must not
turn such a model into an uncharged route by editing its configuration or rate.

## Decision

Keep normalization, exact units and budget coordination in community code.
An optional named funding participant resolves protected model configurations,
supplies an immutable retail quote, and reserves/settles its own tables through
a transaction-bound SQL executor. The public coordinator owns the actual
commit/rollback and team guard. Participants do no network I/O inside callbacks,
cannot commit the transaction, and cannot reuse the executor after returning.

Persist the route owner, rate snapshot and admitted point/token bounds before
dispatch, including when no public policy exists. Missing participants fail
closed. Missing or ambiguous usage retains both holds. A supplier bound breach
suspends subsequent strict calls even without a team budget. Ordinary BYOK
requests never invoke monetary participants.

Only the owner publishes protected configurations through its scoped host
capability. Generic configuration updates and reference-price writes cannot
change their route or retail price. An admin may remove an unused configuration;
the durable owner and request snapshots still permit settlement afterward.

Team administrators retain BYOK reconciliation. An operator-only host capability
reconciles an owned request using its captured rates and the matching participant
in the same transaction. Explicit counts/reason are mandatory. An estimate and
late observed evidence remain distinguishable; no customer-facing API receives
an arbitrary monetary-adjustment capability.

## Consequences

- Community budgeting still works without a participant or hosted account.
- Both modules use one exact amount/token representation; no second parser or
  database connection can create an independent charge for the same response.
- Extensions remain trusted server code and access only their own tables. The
  narrow executor is a transaction-lifetime boundary, not a SQL sandbox.
- A financial settlement failure leaves both reservations intact. Recovery may
  require an operator estimate; a timeout alone cannot release billed capacity.
