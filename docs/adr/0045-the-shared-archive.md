# 0045. A shared DSH's archive is sealed segments in a signed chain, kept in the database

> **Status:** Superseded by 0067 · **Date:** 2026-11-18

## Context

A shared DSH (`docs/tech/shared-dsh.md`) is driven by several
members over an end-to-end encrypted relay the server cannot read. The team
still needs a record of what each member did on its machine, and the developer
decided the server should keep that record while still unable to read it: the
admin decrypts it when they need to, and it is kept with no expiry. The record
is written once and read rarely, possibly years later, by tools that must know
exactly what the bytes mean, so its format is expensive to change.

Options weighed:

- **The server keeps relay traffic as it passes.** It is sealed to the
  pairing's session keys, which are fresh per connection and held only by the
  two ends, so nobody could ever read it.
- **The DSH re-encrypts to a key the server derives.** The server could then
  read it, which the trust model rules out.
- **The DSH seals records to a key only the admin holds** (chosen).
- For storage, the byte store (local directory or S3, ADR 0033) or database
  rows. Segments are at most about 1.4 MB, written once a minute at most per
  host, and a self-hosted SQLite instance has no byte store configured by
  default.

## Decision

- **The admin's key is an X25519 pair made on their own machine**
  (`dsh-teamwork-audit keygen`, in the plugin's package). The DSH holds only
  the public key, set by `/teamwork share audit-key`, and admits no member
  until it has one. The server never sees either half.
- **A record** is `{at, member, device, dir, frame}`: one frame between a
  member's device and the DSH, either way. A string over 64 KiB in it is
  kept as `{omitted: <length>, sha256}`.
- **A segment** is the records of up to one minute or 1 MiB, as JSON,
  HPKE-sealed (RFC 9180 base mode: DHKEM X25519, HKDF-SHA256, AES-256-GCM,
  empty info) to the audit key. It travels and is stored as one JSON object,
  `{v: 1, host, seq, prev, key, enc, ct, sig}`:
  - `seq` counts from 1 per host; `prev` is the SHA-256 (hex) of the previous
    segment's exact bytes, empty for the first; `key` is the SHA-256 (hex) of
    the raw audit public key;
  - the AEAD's associated data is
    `"dsh-teamwork audit segment\n" + host + "\n" + seq + "\n" + prev + "\n" + key`,
    so a header moved onto another ciphertext does not open;
  - `sig` is an Ed25519 signature, by the identity key the DSH bound to its
    host key, over that header, a newline, and the SHA-256 (hex) of
    `enc + "." + ct`.
- **The server accepts a segment only as the next in its host's chain**
  (`POST /relay/shared/archive`, the host token), signed by that host's bound
  identity key, and keeps its exact bytes as a row of
  `shared_archive_segments` until the team is deleted. A retried upload of
  the last segment is answered as kept. The admin downloads a host's segments
  as one JSON object per line, in order.
- **The DSH writes each segment to disk before it uploads it**, and uploads in
  order, so a lost connection delays the archive and drops nothing.

## Consequences

- The server proves order and authorship without reading anything, and the
  admin's reader (`dsh-teamwork-audit read`) shows a missing, reordered or
  altered segment, and one sealed to another key.
- **A lost private key loses everything sealed to it.** A new key seals new
  segments only. Rotating the key needs no server change: the fingerprint in
  each header says which key opens it.
- A DSH that stops uploading, or is switched off, leaves a gap the server
  cannot tell from a quiet machine; the chain only shows what was uploaded.
  The DSH itself is trusted to record honestly, as it is trusted to run the
  sessions.
- The archive grows without bound and lives in the main database, which a
  self-hosted SQLite instance backs up with everything else. Moving it to the
  byte store later is a data migration, not a format change: the stored bytes
  are the format.
- What a frame looks like is DSH's Remote API and the relay protocol, which
  change; a reader of an old archive reads frames as they were.
- Deleting a shared DSH keeps its archive; deleting the team deletes it.
