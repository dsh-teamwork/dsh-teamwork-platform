---
title: Overview
description: What DSH Teamwork is, how its parts fit together, and where to start.
---

DSH Teamwork is the team edition of DeepSeek Harness (DSH). A team admin
publishes models, presets and plugins once in the web console; every member's
DSH picks them up through the Teamwork plugin, calls team models through this
server, and never holds a provider key.

## Where to start

- **Everyone:** [Install the plugin](/docs/install) in your DSH, then sign in.
- **Team admins:** [Set up a team](/docs/admins): connect a provider, publish
  models and presets, bring people in and set budgets. To run a DSH on a server
  for the whole team, see [Team DSH](/docs/team-dsh).
- **Members:** [Work with your team](/docs/members): pick a preset, share what
  works, ask the team assistant.
- **Operators:** [Run your own server](/docs/self-hosting) with the open-source
  community edition.

## The parts

| Part | Where it runs | What it does |
| --- | --- | --- |
| Teamwork plugin | Each member's DSH | Signs in, syncs the team's resources, sends team-model calls to the server |
| Team console | This website | Models, presets, plugins, review, history, usage, budgets and members |
| Server | The hosted service, or your own | Keeps provider keys, checks membership on every call, records usage |

## What stays where

- **Provider keys** are encrypted on the server. They cannot be read back and
  never reach a member's computer.
- **Conversations** stay in each member's DSH. The server forwards team-model
  calls and records their token counts, never the prompt or the reply.
- **Your own setup** stays yours. Team resources sit next to it and overwrite
  nothing.
