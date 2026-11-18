# 0042. Editions store objects in the server's store, beside the plugin archives

> **Status:** Accepted · **Date:** 2026-11-17

## Context

The hosted edition keeps each cloud session's record after its VM is gone:
DSH's own session file, read back when the member opens the session again
and later written into a new VM to continue it. That is bytes, not rows,
and the server already has a byte store: `server/internal/artifactstore`, a
data directory or the S3 bucket `ARTIFACT_STORAGE_PROVIDER=s3` names, which
holds private plugin archives under `teams/{teamId}/plugins/{artifactId}.tgz`
(ADRs 0033 and 0034). A closed edition cannot reach an internal package. The
alternatives were:

- **The edition opens its own bucket.** A second S3 client, a second set of
  variables and a second place for an operator to configure, back up and
  delete from.
- **The bytes go in the database.** Session files grow with every tool
  result; three dialects' blob limits and backups would carry them.
- **The server lends its store to editions.**

## Decision

**`edition.Host.Objects` lends an extension the server's own store, under
keys of a kind the extension names: `teams/{teamId}/{kind}/{id}`.**

- A kind is lower-case, at most 32 characters, and never `plugins`, so an
  edition can neither read nor overwrite a plugin archive. Team and id are
  validated as the plugin archives' are.
- `Put`, `Open` and `Delete`; a missing object is `fs.ErrNotExist`. Objects
  carry no metadata: the extension's own tables say what exists, and the
  extension deletes what it stored, including when its retention runs out.
- `Objects` is nil on a management process, which opens no store.

## Consequences

- One store, one set of variables and one bucket to back up for every edition.
- The key layout is now a storage format: objects already written under a kind
  stay there, and moving them is a migration of the bucket.
- A community instance mounts no edition and stores nothing new.
- The server cannot list or expire an edition's objects for it; an extension
  that forgets to delete leaves bytes behind.
- Ruled out: a second bucket per edition, session bytes in the database, and
  an edition writing among plugin archives.
