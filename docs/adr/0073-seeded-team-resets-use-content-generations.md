# 0073. Seeded team resets use content generations

> **Status:** Accepted · **Date:** 2026-11-27

## Context

An edition needs to restore a public team's demonstration content every day
without removing its members, models, usage or financial history. Resetting by
deleting the team would break all of those references. Resetting only the rows
visible at one instant would also allow a write admitted before the reset to
commit after it and silently repopulate member content. Object bytes cannot
participate in the database transaction, so their order matters too.

## Decision

Keep the team and its memberships in place and replace member-changeable
content with a deliberately small seed: team-owned presets/plugins, flat
knowledge documents and single-file artifacts. `teams.content_generation`
increments in the same transaction as the replacement and is returned to the
edition. A content write records that generation at admission and checks it
again immediately before commit, locking the team row where the dialect
supports it. An edition may also refuse new writes while its reset runs; a
late commit fails with `team_resetting`. Model inference, membership and usage
are not content writes.

Seed objects are written before the database transaction. Old objects are
collected after commit, while a failure rolls back the rows and leaves only
unreferenced bytes for collection. The committed generation lets a later reset
recover even if the process died between the content and state commits. The
same Host capabilities provision a sign-in-less system team, add an ordinary
member idempotently, and reconcile a small point budget without adding a
revision when it is unchanged. The web console gains optional notice slots
whose community default is empty.

## Consequences

- Every dialect gains an additive `content_generation` migration. Ordinary
  teams start at zero and change only when an edition resets them.
- The ent driver fences every transaction admitted with a generation, rather
  than relying on each route to remember a check. MySQL compares the value
  rather than relying on affected-row counts for a no-op update.
- The seed is not a general team-template system: folders, attachments,
  private packages, models, memberships and financial records are outside it.
  Supporting any of them later is an explicit format and recovery change.
- A system creation binds edition models without asserting ordinary
  account-acquisition eligibility. Editions must honor the `System` event mark
  in their own provisioning rules.
- Reset is destructive to the demo's cloud member content by design, not a
  backup/restore feature. Local DSH files and sessions are outside it.
