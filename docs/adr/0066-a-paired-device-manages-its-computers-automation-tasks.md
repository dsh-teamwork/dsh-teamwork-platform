# 0066. A paired device manages its own computer's automation tasks

> **Status:** Accepted · **Date:** 2026-11-23

## Context

DSH's Schedule service (`@deepseek-ai/dsh-schedule`, "Automation tasks" in
DSH's own sidebar) stores instructions that the computer delivers later, at a
time or on a repeating rule, to an existing session or to one it creates. It
ships in DSH's default Web composition from 0.2.2-rc.3, the oldest DSH the
plugin supports, and its Remote namespace `schedule/*` serves a human caller:
`catalog`, `view`, `history`, `create`, `edit` (update, pause, resume,
delete), `run` and `deliveryLimits`, with `schedule/changed` on `$events`
after every committed change. A probe against DSH 0.2.2-rc.4 confirmed that
the bridge's answering identity (`/connect` with `interactions=answer`) may
call every one of them.

Until now a phone or browser could only act in the moment: every call on the
allow-list ([relay.md](../tech/relay.md), "The allow-list") either reads or
does something now. Creating a task is different in kind: the phone leaves an
instruction that the computer runs later, unattended, under the permission
preset of the session it lands in, while nobody is looking.

The task catalog is the whole DSH's. A Schedule task records no person, and a
task aimed at a new session creates a session no member owns.

## Decision

**A paired device may manage the automation tasks of a personal computer,
through DSH's own `schedule/*` methods passed on unchanged. A shared DSH
refuses them.**

- The bridge's allow-list gains `schedule/catalog`, `schedule/history`,
  `schedule/create`, `schedule/edit` and `schedule/run`, and passes each with
  its native shape. `list`, `view`, `deliveryLimits` and `deleteInactive`
  stay off until a screen needs them.
- On a personal computer the pairing's member is the computer's owner, so a
  task may name any session, directory or preset, as `session/create` and
  `session/prompt` already may. A task runs with nothing a phone could not
  already do by sending the same prompt itself.
- On a shared DSH every `schedule/*` call is answered
  `teamwork/schedule_unavailable` without reaching DSH, and
  `schedule/changed`, which names no session, never reaches a member.
- A task's delivery is shown in the session it lands in: `[SCHEDULE REMINDER]`
  messages become the user's own turn, marked as a reminder. DSH's
  `[SCHEDULE CHANGE]` notices, which tell an agent that a task changed
  elsewhere, are not shown.
- A task fires only while its computer's DSH runs. A cloud computer outside
  its running window does not fire, and the server does not start it for one.

## Consequences

- Phone and web gain a task page and in-session reminders with no new server
  route, table or wire format of their own: the relay still carries opaque
  frames, and the contract is DSH's.
- A stolen, still-paired phone can leave instructions that keep running after
  it is revoked. Revoking a pairing does not delete its tasks; the owner
  deletes them from any device or from DSH itself.
- DSH's experimental Remote API is now a larger part of what the plugin
  passes on, so a pinned-version change revalidates `schedule/*` too.
- Ruled out for now: tasks on a shared DSH (they need an owner per task and
  an owner for the sessions they create), the server waking a stopped cloud
  computer for a due task, and server-held triggers in place of DSH's own.
