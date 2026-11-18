---
title: Commands
description: Every /teamwork command, typed into DSH's command input.
---

Type these in DSH's command input, not in your shell. Ids come from
`/teamwork list`.

| Command | What it does |
| --- | --- |
| `/teamwork login` | Open browser sign-in. |
| `/teamwork authorize <code>` | Finish sign-in with a code from the website. |
| `/teamwork share enable <key>` | Make this DSH a Team DSH of its team, with a key from **Team assets → Team DSH**. |
| `/teamwork share disable` | End shared mode and delete the key. |
| `/teamwork share status` | Show the Team DSH's name, team and token. |
| `/teamwork share invite <email>` | A single-use link that pairs one listed member's device with this Team DSH. |
| `/teamwork share members` | Who may reach this Team DSH, and their devices. |
| `/teamwork share unlock <email>` | Clear a member's PIN and lock on this Team DSH. |
| `/teamwork share audit-key <key>` | Seal this Team DSH's archive to the key `dsh-teamwork-audit keygen` printed; members are admitted only once it is set. |
| `/teamwork pin reset` | Clear your own phone PIN and lock on this computer. |
| `/teamwork status` | Show sign-in, sync state and recent errors. |
| `/teamwork sync` | Refresh the team's resources now. |
| `/teamwork list` | List the team's resources and their ids. |
| `/teamwork info [id]` | Show a preset's details and whether it is ready. |
| `/teamwork new <id>` | Start a session from a preset. |
| `/teamwork use <id>` | Use a team resource in a session that has not started. |
| `/teamwork tools` | Show the tool names DSH can see. |
| `/teamwork plugins [presetId]` | Check the plugins presets depend on. |
| `/teamwork install <id>[@<version>]` | Preview a plugin installation; repeat with `confirm` to install. |
| `/teamwork session [check]` | Show the session's state; `check` re-checks team access. |
| `/teamwork continue <instruction>` | Send a follow-up after the readiness checks. |
| `/teamwork cancel` | Ask the session to stop. |
| `/teamwork retry` | Preview a recovery; `retry confirm` sends it. |
| `/teamwork logout` | Sign out and drop the team's resources from DSH. |

## On a server: dsh-teamwork

On the machine a DSH runs on, `dsh-teamwork` (`npm install -g @dsh-teamwork/dsh-teamwork`) does
what the Teamwork panel does, from a shell, with no browser: for a DSH on a
server, a Team DSH above all. DSH must be running there as the same user; the
command finds it through the plugin's directory in `~/.dsh`, or `$DSH_HOME`.
Linux and macOS.

| Command | What it does |
| --- | --- |
| `dsh-teamwork server [url]` | Show the Teamwork server, or set it: a self-hosted team does this first. |
| `dsh-teamwork login` | Print a sign-in link to open in any browser. |
| `dsh-teamwork authorize <code>` | Finish sign-in with the code the page shows. |
| `dsh-teamwork status` | Sign-in, teams, sync, the relay and paired phones. |
| `dsh-teamwork sync` | Sync the team's configuration now. |
| `dsh-teamwork logout` | Sign out and drop the team's resources. |
| `dsh-teamwork phone pair` | Draw the phone app's pairing QR code in the terminal. |
| `dsh-teamwork phone list` | Paired and waiting phones, with a waiting phone's safety code. |
| `dsh-teamwork phone accept <id>` | Accept a waiting phone once it shows the same safety code; `reject <id>` refuses it. |
| `dsh-teamwork phone revoke <id>` | Remove a paired phone. |
| `dsh-teamwork share enable <key>` | Make this DSH a Team DSH, with a key from **Team assets → Team DSH**. |
| `dsh-teamwork share audit-key <key>` | Seal its archive to the key `dsh-teamwork-audit keygen` printed. |
| `dsh-teamwork share status` | Its name, team, audit key and any error. |
| `dsh-teamwork share members` | Who may reach it, their devices, and who is locked. |
| `dsh-teamwork share invite <email>` | A single-use link that pairs one listed member's device. |
| `dsh-teamwork share unlock <email>` | Clear a member's PIN and lock. |
| `dsh-teamwork share disable` | End shared mode and delete the key. |

