# Automation tasks

> **Status:** Plan — steps 1 to 4 built · **Updated:** 2026-11-23

How a member manages and follows their computer's automation tasks (DSH's
Schedule) from the web console and the phone: through DSH's own `schedule/*`
Remote API over the relay ([ADR 0066](../adr/0066-a-paired-device-manages-its-computers-automation-tasks.md)),
with no store of the server's own.

## The route in one paragraph

DSH keeps the tasks and delivers them; Teamwork only reaches them. A client
calls `schedule/*` through the paired channel like any other call
([relay.md](relay.md), "The allow-list"); the plugin passes the method on
unchanged on a personal computer and refuses it on a shared DSH;
`packages/relay-client` reads the answers into a client's shapes and turns
`schedule/changed` on `$events` into a refresh. A due task lands in its
session as a user turn, which the client shows as a reminder.

## What DSH provides

Probed against DSH 0.2.2-rc.4 through the bridge's answering identity; the
Schedule service is in DSH's default Web composition from 0.2.2-rc.3. These
five are the ones passed on; DSH's `list`, `view`, `deliveryLimits` and
`deleteInactive` are not, until a screen needs one.

| Method | Request (`args.request`) | Answer |
| --- | --- | --- |
| `schedule/catalog` | none | every task, active first |
| `schedule/history` | `{ id, limit 1–100, before? }` | saved deliveries, newest first, with `nextBefore` |
| `schedule/create` | `{ title, prompt, timing, target? }` | the stored task |
| `schedule/edit` | `{ id, action: 'update', patch, expectedUpdatedAt? }` or `{ id, action: 'delete' }` | the task, `{ id, deleted }`, or a miss (`schedule_not_found`, `schedule_ended`, `schedule_conflict`) |
| `schedule/run` | `{ id }` | the task after delivery, or `schedule_execution_pending` |

- **A task** is `id`, `kind`, `title` (at most 120 characters), `prompt`,
  `scheduledAt` (the next occurrence, UTC), its kind's fields, `target`,
  `status` (`active`, `paused` or `ended`), `createdAt`, `updatedAt`, and
  after a delivery `lastDelivery` (`scheduledAt`, `deliveredAt`,
  `messageId`, `targetSessionId`).
- **Timing** is `{ kind, … }`: `after` (`after_seconds`), `at` (an instant),
  `every` (`every_seconds`, at least 60), `daily` and `weekly`
  (`time`, `time_zone`, weekly's `weekdays` 1–7), `cron` (`expression`,
  `time_zone`) or `rrule`. Stored fields are camelCase (`timeZone`).
- **Target** is `session` (`sessionId`), `new_once` (one session made on the
  first delivery and reused, the default) or `new` (one per delivery).
- **Errors.** Invalid input is `schedule/input-invalid` with `details.code`
  (`invalid_prompt`, `invalid_rule`, …); an archived target is
  `schedule/target-archived`.
- **Pause and run.** Pausing keeps the task; resuming computes its next
  future occurrence. `run` delivers now whatever the status, and does not move
  the next occurrence.

## Goal

- A member opens a computer's **automation tasks** in the web console (My DSH,
  and an edition's Cloud DSH, which share its parts) and in the phone app:
  every task with its rule, next run, target and status; create one, edit it,
  pause and resume it, run it now, delete it, and read its deliveries.
- **In a session**, the tasks that deliver to it are listed in its header,
  a new one can be made for it, and each delivery is shown as a reminder, not
  as raw framing text.

## Non-goals

- **A shared DSH.** Its catalog is the whole DSH's and a task names no person;
  `schedule/*` is refused there until tasks have owners (open question 1).
- **Waking a stopped cloud computer.** A task fires only while DSH runs; a
  cloud computer outside its running window misses it, and the screen says so.
- **Server-held triggers** (webhooks, Lark or GitHub events). They remain the
  hosted edition's later plan and are not built on this.
- **Editing an RRULE.** A task with one is shown as custom and edited only at
  DSH; cron is the custom rule a client writes.
- **Notifications** when a task delivers.

## The pieces

| Piece | Where |
| --- | --- |
| The allow-list, and the refusal on a shared DSH | the plugin's `src/bridge.ts`, held by `tests/bridge.test.ts` |
| Tasks read into a client's shapes, the calls, the refresh on `schedule/changed`, reminders in a session | `packages/relay-client` (`schedule.ts`, `dsh-sessions.ts`, `dsh.ts`) |
| The task page, the session header and the reminder note | `apps/web/src/pages/team/dsh-tasks.tsx`, mounted by `my-dsh.tsx` and `dsh-session.tsx` |
| The same on the phone | `premium/apps/mobile`, where that directory exists |

## Order of work

1. **Probe (done, thrown away).** DSH 0.2.2-rc.4 answered every method above
   to the bridge's identity, `$events` carried `schedule/changed` with no
   arguments, and a delivery arrived as a `user/message` with
   `source.kind: 'schedule'`.
2. **The channel (built).** The allow-list and the shared refusal in the plugin;
   `relay-client` reads tasks, calls them, watches `schedule/changed`, and
   keeps `[SCHEDULE REMINDER]` messages as the user's turn with `reminders`;
   the plugin's host test (`tests/host/cloud.mjs`) drives them through its
   bridge against a real DSH. Gates everything after.
3. **The web console (built).** The alarm clock left of a computer's
   settings button in My DSH's column opens its tasks (`/teams/{teamId}/my-dsh/{hostId}/tasks[/{taskId}]`):
   the tasks grouped active, paused and ended, a task's detail with run now,
   pause and resume, edit, delete and its deliveries, and the form (once,
   every N minutes, daily, weekly or cron in a named zone; a reused new
   session, a new one each run, or an existing session). An edit sends a
   destination only when it changed, since sending `new_once` again reserves
   another session (`taskPatch` in `relay-client`, which the phone shares). A session's header has a clock with the
   count of active tasks that send to it, opening a popover of what belongs
   to the session (`sessionTasks` in `relay-client`): those tasks with Run
   now and Pause or Resume, the tasks that started it (a new-session task's
   delivery is in it though it is not their destination), a new task aimed
   at it (`?session=`) and all the computer's tasks. A delivered turn names
   its task. A new session's folder and preset are DSH's defaults; the
   form does not choose them yet.
4. **The phone (built, in the closed app where `premium/` exists).** An
   alarm clock in the Sessions header opens the current computer's tasks
   above the tabs: the list, a task with the same actions and deliveries,
   and the form, a one-shot time typed as `YYYY-MM-DD HH:mm` in the phone's
   zone. A session's header has the same clock as the web's, opening the
   same contents in a bottom sheet. A delivered turn names its task.
5. **Cloud DSH.** The task page warns of a next run outside the computer's
   running window.

## Open questions

1. **Owners on a shared DSH.** A task would need its creator recorded by the
   plugin (as `src/shared-owner.ts` records a session's), the catalog filtered
   by it, and a `new` target's session claimed for that member as it is made.
2. **Revoking a pairing.** Tasks a phone made keep running after it is
   revoked (ADR 0066). Whether revoking should offer to delete them needs the
   creating device, which DSH does not record.

## How done is verified

- The plugin's `tests/bridge.test.ts` holds the list and the shared refusal.
- `relay-client`'s tests read a probed catalog, each miss and error, the
  refresh on `schedule/changed`, and a reminder in a session's history.
- The plugin's host test creates, pauses, runs and deletes a task through
  its bridge and a real DSH, and sees the delivery in its session.
- Each screen is checked against a real computer on the web and on a phone.
