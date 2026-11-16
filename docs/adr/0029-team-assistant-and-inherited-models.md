# A built-in team assistant with an inherited model

> **Status:** Accepted · **Date:** 2026-11-15

## Context

A newly created team has no model configuration. Its assistant must exist
before a team provider is configured, and a display name is neither a stable
identity nor a safe uniqueness key.

## Decision

Create one built-in assistant preset in the team creation transaction, with
an immutable nullable `builtin` marker unique per team. Display names may use
120 characters so the full creation-time team name and suffix fit. Later team
renames do not change the preset name. Sync does not provision or recreate it.

Extend preset model selection with an explicit `inheritModel` choice,
exclusive with both a team-model reference and a provider/model route. The
host preserves the current model; new sessions may inherit the originating
session's selection. A missing model produces setup guidance at invocation.
An inherited preset is not a model route for the gateway.

Host tools derive their destination from the active preset context, not a
model-supplied team id. Server membership checks remain authoritative. Editable
prompt text does not grant permissions.

## Consequences

Both platform and plugin must understand inherited selection before deployment.
Existing teams are not backfilled. Built-in status survives config edits but
not explicit deletion; no sync hook silently recreates it. Future review and
history must preserve this identity. Requiring a team model instead would make
an assistant unavailable during the very setup it is intended to help with.
