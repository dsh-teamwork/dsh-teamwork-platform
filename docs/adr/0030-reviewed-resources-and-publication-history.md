# Reviewed resources and immutable publication history

> **Status:** Accepted · **Date:** 2026-11-15

## Context

Team members need to share and update local presets/plugins without acquiring
administrator permissions. Updates must not replace live contents before
review, and historical presets need the exact plugin bytes they referenced.

## Decision

Store frozen submissions separately from live configs. Approval is a
revision-checked transaction containing the decision, current config, immutable
history and private-artifact publication. Direct administrator saves use the
same publication function. Rejection and withdrawal retain the proposal.

Keep private plugin archives in the server's persistent data directory with
opaque ids and server-computed digests. Bound and inspect actual archive bytes
without extracting or executing them. Author/admin access precedes publication;
current team membership authorizes published downloads. Package versions cannot
be overwritten. The host downloads and verifies bytes without handing its token
to the package manager.

Retain publication snapshots and their dependencies after catalog updates and
live deletion. Restoring creates a new reviewed publication, never rewrites
history. Backups export content/dependency metadata and retained private bytes;
external npm dependencies stay explicit references. Default retention is
indefinite, with no automatic purge or whole-team rollback.

## Consequences

The database and artifact directory must be backed up together. Storage usage
grows with retained versions; per-file limits and actionable storage failures
are required, and a future retention policy must protect referenced artifacts.
Server and plugin upgrades must ship together for historical dependency pins.
Host confirmations enforce exact actions even if a model claims prior approval.
A prompt-only assistant, publicly accessible tarballs, or copying old snapshots
over live rows would lose these authorization and recovery guarantees.
