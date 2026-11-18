---
title: Work with your team
description: Use team presets and models in DSH, share your own, and ask the team assistant.
---

Once you are signed in, the team's models, presets and plugins appear in DSH
next to your own setup. In the console, your team opens on **Home**, with your own calls and budget
for the last 30 days and what the team changed lately; **Team
resources** lists what the team provides, with what you have sent for review
under its **My submissions** link; and **My usage** shows the limits that apply
to you, the points you spent by day and by model, and your latest calls, with a
CSV of the period.

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
submit one under **Team resources** in the console: upload a plugin, import a
preset file, or write a new preset or a change to one. An admin reviews
the exact contents; once approved, everyone gets it at their next sync.

## Ask the team assistant

Every team has an assistant preset. Start a session with it and ask about the
team's resources, your usage, budgets, members, or what is waiting for review.
Anything it would change still asks for your approval.

## Work on your own DSH from the browser

**My DSH** appears under Workspace once a computer of yours, with DSH signed in
to Teamwork, has connected. It lists those computers, the same in every team.
Open one and pair this browser with it once: in DSH on that computer, open the
Teamwork panel, choose **Phone** and make a code, type the code here, check
that both screens show the same safety code, and approve on the computer. Then
set a four-digit PIN, which the computer asks for again when you come back.
After that you start, follow and answer sessions on it from the browser, end to
end encrypted between the browser and the computer.

Under **Devices** you see every phone and browser paired with that computer,
and **Remove** cuts any of them off at once, a lost phone included. If you
enter the wrong PIN too often, run `/teamwork pin reset` in DSH on that
computer.

## Work on a Team DSH

If your team runs a Team DSH, its admin hands you an invite link
(`dshteamwork://join?…`). **Team DSH** appears under Workspace in the team console once
its admin lets you reach one; open it,
choose **Join with an invite**, paste it and choose **Join**, then set a four-digit PIN; the
machine asks for it again when you come back. Each browser joins once, and
keeps its key in the browser's own storage: clearing the site's data means
asking for a new invite. You see only the sessions you start there, and your
team's admin can read every session from the machine's encrypted archive. The
phone app opens the same link, or scans its QR code under **Pair a computer**;
the Team DSH then sits in the computer list under your team's name. Your admin's
side of this is [Team DSH](/docs/team-dsh).

## More than one team

You can be in several teams. The plugin syncs all of them; the team selector in
the Teamwork panel only changes which one you browse.

## Deleting your account

Under **Account settings**, choose **Delete account**. Teams you are alone in
are deleted with it. If you are the admin of a team with other people in it,
make one of them the admin first.
