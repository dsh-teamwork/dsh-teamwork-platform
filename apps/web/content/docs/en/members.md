---
title: Work with your team
description: Use team presets and models in DSH, share your own, and ask the team assistant.
---

Once you are signed in, the team's models, presets and plugins appear in DSH
next to your own setup. In the console, your team opens on **Home**; **Team
resources** lists what the team provides, and **My submissions** what you have
sent for review.

## Start from a team preset

Choose **New session** with a team preset, or run `/teamwork new <id>`. A preset
brings its model, required tools and pinned plugins. If something it needs is
missing, DSH tells you before you start.

A session keeps the preset version it started with. Start a new session to use
an update.

## Use a team model

Team models appear among your models. Calls go through the team's server, so
your computer needs no key. Your team's budget applies to them.

## Install a pinned plugin

Run `/teamwork plugins` to see which pinned plugins your presets need, then
`/teamwork install <id>` to preview the exact version. Nothing is installed until
you confirm.

## Share what works

Ask the team assistant to prepare a preset or plugin from your session, or
submit one in the console: a plugin or a preset file under **My submissions**,
or a new preset, or a change to one, under **Team resources**. An admin reviews
the exact contents; once approved, everyone gets it at their next sync.

## Ask the team assistant

Every team has an assistant preset. Start a session with it and ask about the
team's resources, your usage, budgets, members, or what is waiting for review.
Anything it would change still asks for your approval.

## Reach a shared DSH

If your team runs a shared DSH, its admin hands you an invite link
(`dshteamwork://join?…`). Open **Shared DSHs** in the team console, paste it
under **Invite link** and choose **Join**, then set a four-digit PIN; the
machine asks for it again when you come back. Each browser joins once, and
keeps its key in the browser's own storage: clearing the site's data means
asking for a new invite. You see only the sessions you start there, and your
team's admin can read every session from the machine's encrypted archive. The
phone app opens the same link.

## More than one team

You can be in several teams. The plugin syncs all of them; the team selector in
the Teamwork panel only changes which one you browse.

## Deleting your account

Under **Account settings**, choose **Delete account**. Teams you are alone in
are deleted with it. If you are the admin of a team with other people in it,
make one of them the admin first.
