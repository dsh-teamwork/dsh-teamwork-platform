# 0033. Private artifact storage providers

> **Status:** Superseded by 0034 for object keys and path migration · **Date:** 2026-11-15

## Context

Private plugin metadata is durable in the database, but container-local archive
bytes disappear when a hosted instance is replaced. Community installations
need a zero-configuration local directory; hosted deployments need shared,
durable object storage without binding private downloads to one container.

## Decision

Platform owns local-directory and S3-compatible implementations of the same
byte-store interface. Local remains the default. S3 is selected explicitly by
environment variables; configuration or request failures never fall back to
local disk. Both providers keep `<artifactId>.tgz` keys and unchanged database
digests. Upload validation, team authorization, publication, download and
history remain in the existing server paths. The bucket stays private; the
server proxies downloads instead of exposing reusable object URLs. Use the
AWS Go SDK v2 for signing, endpoint resolution and S3 error handling.

## Consequences

Community installs retain their existing directory layout. Hosted member
instances can share one S3 bucket without a shared filesystem; management-only
processes need no bucket credentials. Temporary disk remains necessary for
bounded archive inspection and seekable downloads. Metadata and object storage
are not one transaction: upload bytes first, commit metadata second and attempt
cleanup if a constraint rejects the insert; ambiguous database failures retain
the object for reconciliation, and failed cleanup is logged. Backups
must include both stores. Provider changes require an offline copy and digest
verification, not just an environment toggle; the migration command preserves
sources and does not silently repair missing original files.
