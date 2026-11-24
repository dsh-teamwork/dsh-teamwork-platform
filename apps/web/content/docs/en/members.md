---
title: Work with your team
description: Use team presets and models in DSH, share your own, and ask the team assistant.
---

Once you are signed in, the team's models, presets and plugins appear in DSH
next to your own setup. In the console, your team opens on **Home**. Until your
DSH is connected, it opens with the steps: sign in to Teamwork from DSH on your
computer, then pair a browser (**My DSH**) or the phone app with it, each ticked
off by itself as it happens. Below that are your own calls and budget
for the last 30 days and what the team changed lately; the **Team toolbox**
lists the team's presets and plugins, each opening its details, with what you
have sent for review under **My submissions** at its top right once you have
sent something; and **Models and usage** lists the team's models
with their rates, then shows the limits that apply to you, the points you spent
by model and by day, and your latest calls, with a CSV of the period.

## Start from a team preset

Choose **New session** with a team preset, or run `/teamwork new <id>`. A preset
brings its model, required tools and pinned plugins. If something it needs is
missing, DSH tells you before you start.

A session keeps the preset version it started with. Start a new session to use
an update.

## Use a team model

Team models appear among your models. Calls go through the team's server, so
your computer needs no key. Your team's budget applies to them. The console's
**Models and usage** lists each team model's rate and what you spent on it.

## Install a pinned plugin

Run `/teamwork plugins` to see which pinned plugins your presets need, then
`/teamwork install <id>` to preview the exact version. Nothing is installed until
you confirm.

## Share what works

Ask the team assistant to prepare a preset or plugin from your session, or
submit one in the console's **Team toolbox**: upload a plugin, import a
preset file, or write a new preset or a change to one. An admin reviews
the exact contents; once approved, everyone gets it at their next sync.

## Ask the team assistant

Every team has an assistant preset. Start a session with it and ask about the
team's resources, your usage, budgets, members, or what is waiting for review.
Describe a preset you want and it drafts the whole thing (persona, method,
model and tools), shows it to you, and submits it for review once you agree.
An admin can have it create or change presets, review submissions, or turn a
month's usage into an artifact. It suggests what to do next from what it finds.
Anything it would change still asks for your approval, and an artifact it publishes
stays yours until you share it.

## Work on your own DSH from the browser

**My DSH** sits under Home in Workspace. Every computer of yours whose DSH
signed in to Teamwork is listed there; until one has, it says how to connect
one. Its computers fold out beneath it in the sidebar,
the same in every team, each with a dot that is green while it is online; the
arrow at the end of **My DSH** folds them away. Open one and its sessions fill
the column beside the sidebar, under its name, its operating system and its
settings button. Pair this browser with it once: in DSH on that computer, open the
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
a reply (at its line, for `src/app.ts:42`), a link to a local file or a file
the agent presented at the end of its reply. PDFs and Excel workbooks (up to
16 MiB) open as a page-by-page or sheet-by-sheet preview, drawn in a sandbox
that cannot act as you; Word and PowerPoint files open the same way when the
computer's DSH has Office Kit. It reaches nothing outside that directory, and
needs DSH Teamwork 0.16.0 or later on the computer, 0.19.6 for the previews.
Beside the paperclip, the permission menu sets what the agent may do on that
computer: **Read only**, **Workspace write** or **Full access**, as in DSH;
full access asks you to confirm first.
The model menu groups choices by provider; when the selected model supports reasoning efforts, a reasoning selector appears beside it, set to the model's own default until you change it. In a session that
has started, the folder and preset stay as they are, and you can change its
model and effort while it is not working, for that session alone. The
paperclip at the left of the box adds files (text, code, logs, CSV, JSON or PDF; up to
five, 20 MB each), sent with the message, or on their own.

Above the sessions are the search box, which finds one by its title or its
workspace, the view options beside it, and **New session**. By default the
sessions are grouped as in DSH's own sidebar: each workspace in DSH's order with
its sessions in the order DSH shows them, then **Ungrouped**, newest first, with
pinned ones first in every group; a group's name folds it away. The view
options show archived sessions too, or only them; group by workspace, as a
workspace tree with each workspace under the registered folders that hold it,
or in one list; and order by DSH's own order or by the latest change. They are
kept for each computer in this browser. Grouping by workspace needs a current
DSH Teamwork plugin on that computer; with an older one every session is under
**Ungrouped**. The **⋯** at the end of a session pins it,
renames it, copies its ID or archives it, as in DSH's own sidebar, and both
show the change. Archived sessions are hidden by default, except the one that
is open; a running session can be archived once it stops. The menu needs a current
DSH Teamwork plugin on that computer; with an older one it offers only the
copy. In the phone app, press and hold a session for the same menu.

The alarm clock left of the computer's settings button opens its
**Automation tasks**, the instructions that computer sends on its own: once at a time you pick, every few minutes, every
day, on chosen days of the week, or on a cron expression in a time zone you
name. **New task** gives one a name, the instruction, when it runs and where it
goes: a new session reused each time, a new session each time, or an existing
session. A task opens to its repeat, its next run and its deliveries, each a
link to the session it reached; **Run now** sends it at once without moving
its next run, and **Pause**, **Edit** and **Delete** do what they say. The
agent can make and change the same tasks when you ask it to in a session.
In a session that a task sends to, or that a task started, an alarm clock
beside **Files** shows how many active tasks send to it. It opens those tasks, each with **Run now** and **Pause** or **Resume**;
the task that started the session, when one that opens a new session each run
did; **New task for this session**; and all the computer's tasks. A session
with no task has no clock: make one from **Automation tasks**, choosing that
session under **Sends to**. Each
instruction a task sent shows which task and when it was due. A task runs only while DSH runs on that computer;
one missed while it was off runs once when DSH starts again. Tasks need DSH
Teamwork 0.19.10 or later on the computer.

The settings button beside the computer's name opens its settings. There you
can rename the computer: the name shows in Teamwork, on your phones and in
native DSH Web, and stays when the computer reconnects. You can open its native
DSH Web in a new tab once it is turned on in the computer's Teamwork panel. You
also see every phone and browser paired with it, where **Remove** cuts any of
them off at once, a lost phone included. If you enter the wrong PIN too often, run `/teamwork pin reset` in
DSH on that computer.

**Remove this computer**, on a computer's settings page or on one that is
offline, signs it out of Teamwork at once and takes it from the list with every
device paired with it, even while it is connected. Use it for a lost computer,
one you no longer use, or an old entry left after signing in again. If it signs
in again later, it comes back and is paired anew.

The paperclip in a DSH conversation accepts PNG, JPEG, WebP and GIF when the
selected model supports images. You can attach multiple images. The clients
resize photos to fit 512 KiB per image and 1.5 MiB of images per message, then
transfer them in chunks. The phone app also supports selecting several photos
from the library and taking a photo with the camera.

## Artifacts your agent publishes

Ask the agent in a session for a report, a deck, a dashboard or a diagram, and
to publish it. It appears as a card in the conversation; the card opens the
artifact beside the conversation, and **Artifacts** under Workspace lists every artifact
you published in this team, newest first, with its versions. Asking the agent
for a change adds a version; the earlier ones stay. An artifact starts private to
you, and the agent cannot share it. **Share** offers **Only me**, **Specific
members** and **Everyone in the team**; nobody outside the team can open an
artifact. Whoever can read an artifact sees it under **Shared with me** and can ask
their own agent to change it, which adds a version under their name. As the
owner you can also rename an artifact, restore an earlier version, or delete it.
The team's admin sees every artifact under **All** and can narrow who reads one or
delete it, but reads its content only if it is shared with them. Artifacts run in
a sandbox on their own address, so an artifact cannot act as you in Teamwork. An artifact
may still go full screen and save a file it makes, such as a deck's PDF or
PowerPoint export; your browser shows each download.

In the mobile app, tap an artifact card to open a bottom sheet that takes up about
80% of the screen. Tap the browser icon in the top right to open the same
version in your browser. Tap **Close** to return to the conversation.

## Knowledge

**Knowledge** under Workspace is where the team keeps what it knows: a
glossary, the product's rules, a runbook, as documents in spaces and folders.
Find a document by its title in the box at the top. A document is Markdown,
shown formatted; `[[Another document]]` or `[[Another document#A heading]]`
links to the document with that title in the team, and a title no document has
shows as a broken link.

Each space says who reads it: the whole team, or chosen members. Its
**editors** (the team's admin, whoever created the space, and the members it
names) choose **Edit**, change the text and **Save** it with an optional
one-line note; every save is a new version. **History** lists every version
with its author, where it came from and its note, opens any one, compares it
with the one before it, and lets an editor restore it as a new version. If
someone saved while you were editing, your text stays on screen: compare it
with theirs, then continue on their version and save again. The first time
the console saves a document written elsewhere, it may tidy its Markdown
syntax; that is saved first as a version of its own, noted **Formatting**, so
your version shows only your change.

If you read a space but do not edit it, **Edit** still works: your save
becomes a **proposal** instead of a version.

Your agent, in DSH on your computer or a cloud DSH, reads a synced, read-only
copy of every space you may read, finds what it needs without being pointed
at it, and cites the document and heading its answer rests on. An agent never
changes a document itself, even in an editor's session: it proposes a change.
**Proposals** at the top of Knowledge lists those to spaces you edit, with a
count of the ones waiting on you, and your own. Open one to see what it
changes; an editor **Accepts** it, which makes it the next version under its
author's name, or **Declines** it with a reason, and its author can
**Withdraw** it. A proposal made on a version that has since changed is
**stale** and cannot be accepted; its author proposes again on the current
version.

## More than one team

You can be in several teams. The plugin syncs all of them; the team selector in
the Teamwork panel only changes which one you browse.

## Deleting your account

Under **Account settings**, choose **Delete account**. Teams you are alone in
are deleted with it. If you are the admin of a team with other people in it,
make one of them the admin first.
