# 0021. Usage points and budgets belong to the community edition

> **Status:** Accepted · **Date:** 2026-11-14

## Context

ADR 0005 originally grouped usage with closed billing. A self-hosted team
also needs to understand and limit its provider spending. The developer
explicitly requires points and team/member budgets in the community edition.
Treating them as optional closed callbacks would leave that edition without
the controls it needs and create duplicate accounting implementations.

## Decision

**Usage metering, model reference prices, point conversion, team/member/provider
budgets, reservations, reports, exports and budget alerts are open community
capabilities.** They run locally with the community database and configured
SMTP, without a hosted account, payment service or closed package.

The public gateway owns the one usage and budget execution path. The hosted
edition reuses it and attaches its separately owned wallet participant to
the same admission and settlement transaction. It does not install a second
budget engine or require a wallet for an ordinary BYOK call.

Hosted supplier accounts and curated retail prices, purchased/promotional
wallet grants, introductory offers, payment checkout, refunds, disputes and
service-side financial reconciliation remain closed commercial concerns.
Reference points in a community installation are internal usage units, not
a claim on hosted credit or a right to cash redemption.

This changes only ADR 0005's allocation of usage and budgets. Its licence,
repository split, company governance and other edition boundaries continue
to apply. The accepted historical text is retained unchanged.

## Consequences

- Build and validate the complete BYOK usage/budget workflow in the public
  repository first, including the existing member console and API.
- Usage, price and budget schemas/migrations are public; hosted wallet and
  payment records are closed and refer to public ids through capabilities.
- Community enforcement cannot depend on a premium license, operator console,
  hosted connection, or a supposedly optional accounting extension.
- Wallet reservation and budget reservation must share a transaction when
  both apply, or a failure could leave one held while the other is released.
- Keep common token normalization, pricing precision and quota semantics in
  one implementation. Closed integrations consume snapshots and facts rather
  than duplicate parsing or overwrite the public usage history.
- This is an ownership decision for planned work, not a claim that usage,
  budgets or payments have shipped. Storage and wire commitments receive
  their own implementation-time decisions where needed.
