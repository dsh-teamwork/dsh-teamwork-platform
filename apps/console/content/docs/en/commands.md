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
