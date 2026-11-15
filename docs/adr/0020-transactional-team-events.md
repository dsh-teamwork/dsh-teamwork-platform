# 0020. Transactional team creation and member joins

> **Status:** Accepted · **Date:** 2026-11-15

## Context

An installed edition needs the true team creator and successful member joins
to provision its own records. Current administrator roles do not identify a
creator. Browser notifications or a callback after commit can lose an effect
when the process stops between the public mutation and extension persistence.

## Decision

Expose mount-time `Host.SubscribeTeams`. Creation emits one `TeamCreated`
event including the initial administrator, never an additional join event.
Password-admin addition and accepted invitations emit `MemberJoined` only
after a real membership insertion. A callback borrows an owner-scoped SQL
executor inside that same transaction. It writes only extension tables,
performs no network I/O and propagates failures to roll back the whole mutation.
Callbacks run in extension registration order and expire before commit.

Community installs have no subscriber and no additional persistent records.
There is no historical replay or implicit backfill. An extension that needs
external work must persist its own durable work item here and execute it later;
an extension whose effects are entirely SQL can finish them synchronously.

## Consequences

Public membership and extension provisioning cannot partially commit. A
failed callback can make team creation or joining fail; callers can retry the
original operation after the cause is repaired. Extensions must keep handlers
short, deduplicate their business effects and retain their own facts needed
after a member leaves. No public financial policy or second scheduler is added.
