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
to Teamwork, has connected. It lists those computers, the same in every team,
each with its operating system and the number of devices paired with it. Open
one and pair this browser with it once: in DSH on that computer, open the
Teamwork panel, choose **Devices** and make a code, type the code here, check
that both screens show the same safety code, and approve on the computer. Then
set a four-digit PIN, which the computer asks for again when you come back.
After that you start, follow and answer sessions on it from the browser, end to
end encrypted between the browser and the computer. Each computer says whether
it is online and whether this browser is paired with it; one that is offline
offers nothing until DSH runs on it again, and the page carries on by itself
once it connects.

A new session waits in the middle of the page, laid out as in DSH: above the
message box, the computer's folders and presets (a team preset included; one
the computer cannot run yet says why), and in its bottom row the model, before
its first message; leave them as they are for the computer's defaults. Once
the first message is sent, the session opens in place.
The folder starts as this team's default workspace on that computer, which
you set in DSH's Teamwork panel under **My teams**.
**Files**, beside a session's title, opens its working directory at the
right, read only: the files the session wrote or edited, and every folder,
searchable by file name, each text file shown with its line numbers. A file
the conversation names opens there when you click it: a step's file, a path in
a reply (at its line, for `src/app.ts:42`) or a link to a local file. It
reaches nothing outside that directory, and needs DSH Teamwork 0.16.0 or later
on the computer.
Beside the paperclip, the permission menu sets what the agent may do on that
computer: **Read only**, **Workspace write** or **Full access**, as in DSH;
full access asks you to confirm first. On a Team DSH only the first two can be
picked; anything wider is set on the machine itself.
A model that can reason harder offers its efforts beside it. In a session that
has started, the folder and preset stay as they are, and you can change its
model and effort while it is not working, for that session alone. The
paperclip at the left of the box adds files (text, code, logs, CSV, JSON or PDF; up to
five, 20 MB each), sent with the message, or on their own.

The open computer lists its latest sessions under it, pinned ones first, with
**Show all** for the rest; the arrow at the end of its row folds them away, so
the other computers stay in reach. The **⋯** at the end of a session pins it,
renames it, copies its ID or archives it, as in DSH's own sidebar, and both
show the change. Archived sessions are hidden until you open **Archived**; a
running session can be archived once it stops. The menu needs a current
DSH Teamwork plugin on that computer; with an older one it offers only the
copy. In the phone app, press and hold a session for the same menu.

The device count beside a computer opens its devices: every phone and browser
paired with it, where **Remove** cuts any of them off at once, a lost phone
included. If you enter the wrong PIN too often, run `/teamwork pin reset` in
DSH on that computer.

**Remove this computer**, on a computer's devices page or on one that is
offline, signs it out of Teamwork at once and takes it from the list with every
device paired with it, even while it is connected. Use it for a lost computer,
one you no longer use, or an old entry left after signing in again. If it signs
in again later, it comes back and is paired anew.

## Pages your agent publishes

Ask the agent in a session for a report, a deck, a dashboard or a diagram, and
to publish it. It appears as a card in the conversation; the card opens the
page beside the conversation, and **Pages** under Workspace lists every page
you published in this team, newest first, with its versions. Asking the agent
for a change adds a version; the earlier ones stay. A page starts private to
you, and the agent cannot share it. **Share** offers **Only me**, **Specific
members** and **Everyone in the team**; nobody outside the team can open a
page. Whoever can read a page sees it under **Shared with me** and can ask
their own agent to change it, which adds a version under their name. As the
owner you can also rename a page, restore an earlier version, or delete it.
The team's admin sees every page under **All** and can narrow who reads one or
delete it, but reads its content only if it is shared with them. Pages run in
a sandbox on their own address, so a page cannot act as you in Teamwork.

## More than one team

You can be in several teams. The plugin syncs all of them; the team selector in
the Teamwork panel only changes which one you browse.

## Deleting your account

Under **Account settings**, choose **Delete account**. Teams you are alone in
are deleted with it. If you are the admin of a team with other people in it,
make one of them the admin first.
