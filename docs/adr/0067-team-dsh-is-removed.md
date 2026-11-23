# 0067. Team DSH is removed

> **Status:** Accepted · **Date:** 2026-11-23

## Context

Team DSH was a DSH a team ran on its own machine and shared with its members
through the relay ([ADR 0044](0044-the-relay-and-shared-dshs-are-open.md)).
It signed in with a team host key traded for a host token
([ADR 0047](0047-host-tokens.md)), which synced one team's configuration and
called its models as no person, billed to the team. Members joined it by an
invite the machine issued, each behind a PIN, and it saw only the sessions
they started; every frame was sealed to the admin's audit key and kept as the
shared archive ([ADR 0045](0045-the-shared-archive.md)).

It had been offline for some time: the binary mounted none of its routes, so
no machine got a host token and no member reached one, while its code, its
tables, its console pages and its rules stayed in every change. Those rules
also held back what a member does on their own computer. Anything that acts
for a person had to answer what it would mean on a machine no person owns:
automation tasks were refused on a shared DSH until tasks could have owners
([ADR 0066](0066-a-paired-device-manages-its-computers-automation-tasks.md)),
risky permission presets carried an `allowed` flag for it, and a page needed
a starter.

## Decision

**The developer removed Team DSH, with everything that existed only for it.**
Gone are the shared hosts and their member lists, the team host key exchange
(`/relay/shared/challenge`, `/relay/shared/token`), the member routes
(`GET /relay/shared`, `POST /relay/shared/{hostId}/join`), the admin's
`/api/teams/{teamId}/shared-hosts` routes, the shared archive
(`POST /relay/shared/archive`, `/api/teams/{teamId}/shared-archive`), host
tokens and the edition hooks that minted and gated them, calls and page
versions recorded against a host rather than a member, the console's Team DSH
pages, the invite link and `join` in `@dsh-teamwork/relay-client`, the
`allowed` flag on permission presets and the `permission_refused`,
`invite_refused` and `schedule_unavailable` refusals. The migration
`remove_team_dsh` drops `shared_hosts`, `shared_host_members` and
`shared_archive_segments`, and `host_id` from `usage_requests` and
`page_versions`.

The relay now joins a member's devices to that member's own computers only.
Pairing, the device PIN lock, native Web, pages and automation tasks stay as
they were; the PIN is described in `docs/tech/relay.md`.

## Consequences

- Every model call and every page version belongs to a member, so usage,
  budgets and pages have one kind of actor again, and a feature that acts for
  a person (an automation task, a page) needs no answer for a machine no
  person owns.
- A team that wants a shared machine has no way to get one from Teamwork;
  bringing it back is a new decision, designed from per-member ownership
  rather than restored from this one.
- Archived records and shared hosts on an existing database are deleted by the
  migration; nothing can open them afterwards.
- The closed edition follows on its next merge: its app loses `sharedHosts`,
  `join` and `joinLink`, and its server the Team DSH gate and host tokens.
