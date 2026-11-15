# 0023. Community budget reservations and explicit recovery

> **Status:** Accepted · **Date:** 2026-11-14

## Context

Checking a reported total before forwarding a request races across instances.
Missing final usage, policy edits, member overrides and calendar changes can
also create an allowance twice or release a possibly billable call for free.

## Decision

Serialize a team's short accounting transactions with a database guard row.
Reserve every applicable team, member and provider point/token cap together;
dispatch only after commit. Persist the immutable request price and each
reservation's original window and policy revision. Settle the complete set
once, in one transaction, and record append-only counter deltas.

Canonical windows identify actual scopes, independent of the policy id.
Replacing a default-member policy with an override, restoring inheritance,
raising/lowering a cap or disabling enforcement does not reset consumption.
Use daily/monthly calendar windows in an explicit IANA zone. Schedule a zone
change after the current boundary and prevent overlapping new windows.

Require provider-specific conservative input/output bounds for every enabled
hard cap. Initially support direct DeepSeek text/function calls using the
documented context maximum and an explicitly forwarded output limit. Reject
unverified routes and separately billable features before dispatch. Unknown
BYOK providers still have measured reporting without hard enforcement.

Persist a 15-minute call deadline. Lost, cancelled or incomplete calls retain
their holds. A team admin may supply a reasoned BYOK estimate, labelled as
estimated, while retaining original facts and actor identity. Late actual
usage is retained as evidence rather than silently replacing an estimate.
An observed bound violation suspends further hard-budget admissions for the
route until an explicit administrative review.

Insert threshold notifications in the settlement transaction. Deliver them
outside it with leases, current membership/audience checks, retry backoff and
stable message identifiers. SMTP is at least once. Notification failures do
not roll back accounting or relax a cap.

## Consequences

- One shared SQL database coordinates community instances; no Redis or
  hosted subscription is required. Transactions serialize within a team.
- Full-context reservations are intentionally conservative and can reject a
  short prompt when the remaining allowance cannot cover a maximum call.
  Unsupported providers cannot silently inherit a verified route's contract.
- An expired process lease cannot prove zero supplier consumption; pending
  holds require reliable final usage or an explicit, audited estimate.
- These reference budgets do not move money. A later hosted wallet must
  participate atomically and separately restrict monetary reconciliation.
