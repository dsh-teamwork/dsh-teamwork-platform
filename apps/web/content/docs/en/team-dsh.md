---
title: Team DSH
description: Run a DSH for your team on a server, from installing it to a member's first session.
---

A Team DSH is a DSH your team runs on a machine of its own, usually a Linux
server, for its members to work on from the browser or the phone app. It signs
in as the team, never as a person, and its model calls are the team's. Each
member sees only the sessions they start there; you, the admin, can read every
session from its encrypted archive.

Setting one up takes three people's hands, in this order:

1. **You, in the console**: create the machine's key.
2. **You, on the machine**: install DSH, turn it into a Team DSH, set the audit
   key, and invite each member.
3. **Each member, in the browser or the phone app**: join with the invite and
   set a PIN.

## Before you start

- **Team DSH must be enabled for your team.** A self-hosted server enables it
  for every team. On the hosted service it is enabled for some teams at a
  time while its security is proven in use; until yours is, **Team assets →
  Team DSH** says so and offers no key. Write to support to have it enabled.
- **You are the team's admin**, and can open a shell on the machine as the user
  DSH will run as.
- **Every command has two forms.** In DSH's own command input it starts with
  `/teamwork`, as in `/teamwork share status`; in a shell on the same machine it
  starts with `dsh-teamwork`, as in `dsh-teamwork share status`. They do the
  same thing. A server has no DSH window, so this page uses the shell form;
  [Commands](/docs/commands) lists both.

## 1. Install DSH and the plugin on the machine

Follow [Install → A Linux server](/docs/install#a-linux-server): Node.js 24,
DSH, the plugin in DSH's `web` profile, DSH started with `dsh web --no-open`
inside `tmux`, and the `dsh-teamwork` command from npm.

**Start DSH in the folder members will work in.** A member's session starts in
that folder, or in a workspace DSH already has; with neither, members are told
the machine has no project folder to start in.

Check that the command reaches the running DSH:

```sh
dsh-teamwork share status
```

It should say `This DSH is not a Team DSH`. If it says
`No running DSH with the Teamwork plugin`, DSH is not running as this user, or
was started with another `DSH_HOME`.

Do not run `dsh-teamwork login` here: a Team DSH signs in with its key, not as
you.

## 2. Create the machine's key

In the team console, open **Team assets → Team DSH**, give the machine a name
(for example `Build box`) and choose **Create key**. The page shows the key
once, as a command. Copy it: the server keeps no readable copy, and
**Rotate key** is the only way to see a key again.

## 3. Turn the machine into a Team DSH

On the machine, run the command with `dsh-teamwork` in place of `/teamwork`:

```sh
dsh-teamwork share enable dshh_…
```

It prints the Team DSH's name and team. The first machine to use a key keeps
it; on any other machine the same key is refused. In the console, the machine
column now says **Bound**.

From now on the machine signs in as the team on its own, also after a restart:
there is nothing to run again when DSH or the server starts.

## 4. Set the audit key

A Team DSH admits no member until it has your team's **audit key**: it seals
everything members do on it to that key, and uploads it to the server, which
keeps it without being able to read it.

Make the key **on your own computer**, not on the server:

```sh
npm install -g @dsh-teamwork/dsh-teamwork
dsh-teamwork-audit keygen
```

It writes `audit-key.json` in the current folder and prints a line,
`/teamwork share audit-key <public key>`. Run its shell form on the machine:

```sh
dsh-teamwork share audit-key <public key>
```

Keep `audit-key.json` somewhere safe and to yourself. **A lost key cannot be
recovered**, and whoever holds it can read every member's sessions.

## 5. Choose who may reach it

Back under **Team assets → Team DSH**, choose **Access** on the machine's row:
**Everyone in the team**, or **Only these members**. Taking someone off the
list ends their pairings at once.

## 6. Invite each member

On the machine, for each member on that list:

```sh
dsh-teamwork share invite bob@example.com
```

It prints a link, `dshteamwork://join?…`. Each link is for that member only,
works once and expires after a day, and pairs one browser or one phone: a
member who wants both needs two invites. **Hand it over yourself**, in person
or through a channel your team trusts; the Teamwork server never carries it.

`dsh-teamwork share members` shows who is listed and which devices each has
paired.

## 7. The member joins

Send the member the link, and this:

- **In the browser**: in the team console, open **Workspace → Team DSH**,
  choose **Join with an invite**, paste the whole link and choose **Join**.
  Use a current Chrome, Edge, Firefox or Safari, outside private browsing.
- **In the phone app**: open the link on the phone; the app takes it from
  there.

Then they set a four-digit PIN, which the machine asks for again when they come
back, and start a session. They see only the sessions they start there. A
browser joins once and keeps its key in its own storage: clearing the site's
data means asking for a new invite.

[Work with your team](/docs/members#work-on-a-team-dsh) is the member's side of
this, if you would rather send a page.

## 8. Check that it works

On the machine:

```sh
dsh-teamwork status
```

It should say `Signed in: as this Team DSH` and `Relay: connected`; members can
reach the machine only while the relay is connected. `dsh-teamwork share status` also shows the
audit key, and any error from the server. In the console, **Last token**
moves forward about once an hour while the machine runs.

## Day to day

| When | Do this |
| --- | --- |
| A member typed the wrong PIN too often | `dsh-teamwork share unlock <email>`; they set a new PIN when they next connect. |
| A member has a new phone, or cleared the browser's data | `dsh-teamwork share invite <email>` again. |
| Someone should no longer reach it | Take them off **Access** in the console; their pairings end at once. |
| The key may have leaked | **Rotate key** in the console, then `dsh-teamwork share enable <new key>` on the same machine. The old key stops working at once. |
| Move it to another machine | **Delete** it in the console and create a new one; a key stays with the first machine that used it. |
| Stop sharing this machine | `dsh-teamwork share disable` on it, and **Delete** in the console. |
| Update the plugin | See [Install → Update](/docs/install#update), then restart DSH. |

Download the audit archive under **Audit archive** on the same console page and
open it on your own computer:

```sh
dsh-teamwork-audit read shared-archive-….ndjson --key audit-key.json
```

It also says if any part is missing or altered.

## If something goes wrong

- **Members see the machine as offline.** Run `dsh-teamwork status` on it. If
  it says `Relay: off`, update the plugin to 0.11.2 or later and restart DSH;
  earlier versions left the relay off after a restart.
- **`share enable` is refused.** If Team DSH is not enabled for the team, ask
  support. If the key was already used on another machine, create a new one
  for this machine. A key that was rotated or deleted no longer works.
- **A member is told the machine has no project folder.** Restart DSH in the
  folder members should work in (step 1).
- **`share invite` says the member is not on the access list.** Add them under
  **Access** first (step 5).
- **The member's invite is refused.** It is used, expired, or for someone
  else: run `share invite` again for them.
- **Members cannot join at all.** Check that `dsh-teamwork share status` shows
  an audit key (step 4).
