# 0032 — Shared instance management and explicit service roles

> **Status:** Accepted · **Date:** 2026-11-15

## Context

Self-hosted installations need instance administration independently of commercial operations. A closed console duplicating user administration cannot serve that need, and configuring an administrator allowlist is not an explicit service-isolation contract.

## Decision

Platform owns the administrator API, user/team directory, diagnostics and reusable console. Editions register additional routes behind the same guard and compose additional UI pages. Community management lives at `/manage`; an edition may serve a dedicated management origin at its root.

`SERVICE_ROLE=combined|user|manage` selects the process surface. Combined is the self-hosted default. User processes expose no administrator routes; management processes expose no team, model-gateway or plugin-token routes. Authentication remains available to both. Edition user routes and workers follow the same role.

Instance administrators are explicitly listed in `ADMIN_EMAILS`, separate from team roles. Community administrators may use configured password, email-code or Google sessions. A closed operator console may require Google, and financial routes always require an allowlisted Google session, refusing automation keys. Separate deployments share the database but use independent session secrets and origins.

## Consequences

Community users get basic instance management without commercial code. Shared authentication and navigation no longer drift across editions. Deployments must choose their role explicitly when separating services, and hosted management links change from a path-prefixed console to a root-mounted console. The allowlist remains intentionally small; account suspension, token revocation and full audit storage require separate work.
