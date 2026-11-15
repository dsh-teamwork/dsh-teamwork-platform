# 0022. Reference prices and immutable usage snapshots

> **Status:** Accepted · **Date:** 2026-11-14

## Context

Community budgets need comparable model usage without becoming a monetary
wallet. Binary floating point and mutable current prices would make old calls
change value or accumulate rounding errors. Streaming and cancellation can
also leave no trustworthy final usage.

## Decision

Use 1,000 reference points per CNY of configured reference value, with
1,000,000,000 integer accounting units per point. CNY-per-million-token rates
accept six decimal places and convert exactly to units per token. Check
overflow and transmit large amounts as strings.

Model prices are immutable, revisioned team records. Capture the selected
price and authenticated attribution before sending an upstream request.
Store Token facts independently from their point value, using disjoint input,
cached input and output buckets; reasoning already in output is not added.
Unknown prices are unpriced, not zero.

Capture provider JSON/SSE incrementally with bounded observation memory and
retain no prompts or response content in the usage database. Incomplete,
invalid or absent final usage stays pending. A client disconnect never proves
that supplier usage was zero. Finalize each request idempotently.

## Consequences

- Team admins set reference rates without gaining a hosted cash balance;
  members see their own use and admins can inspect the team.
- Changing a model's route invalidates its current price match; changing a
  rate never reprices calls already admitted.
- Attribution survives operational membership/config deletion through ids
  without cascading usage-history edges.
- Public schemas and migrations own these records on every dialect.
- This slice supplies visible metering, not certified hard limits or monetary
  charging. Atomic budget reservations and recovery are the next slice.
