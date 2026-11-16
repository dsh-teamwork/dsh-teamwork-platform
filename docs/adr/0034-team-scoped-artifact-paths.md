# 0034. Team-scoped private artifact paths

> **Status:** Accepted · **Date:** 2026-11-16

## Context

ADR 0033 stores private plugin bytes under flat random keys. Metadata already
owns the team relationship, but a flat bucket makes per-team inventory, export
and future retention work unnecessarily difficult. Existing objects must remain
available while hosted instances upgrade.

## Decision

Both providers use `teams/{teamId}/plugins/{artifactId}.tgz`. The storage
interface takes validated team and artifact IDs; API callers first resolve an
authorized database row. Database identity, digests, archive contents and API
download URLs do not change. Team names and original filenames never enter keys.

Before serving, member processes copy missing scoped objects from flat keys,
checking source and destination size/SHA-256 against metadata. Authenticated
reads perform the same migration for late uploads by an old process. Only a
missing destination permits fallback; corrupted destinations and access errors
fail closed. An offline command runs the same pass. Provider migration from
local to S3 reads either source layout and writes only scoped keys.

## Consequences

All bytes served are verified, migration is repeatable, and flat sources remain
for recovery. Startup reads referenced objects in bounded batches, so its cost
grows with the retained data. Management processes do not touch artifact storage.
Prefixes enable management but grant no access and trigger no deletion; history
and pending submissions retain their existing rights. No schema change is needed.
Rolling back to a flat-key binary requires verified flat copies of newer uploads
too. Removing legacy readers and retained flat objects is a later explicit
migration after old writers are retired, not part of routine startup cleanup.
