# Knowledge

> **Status:** Draft — direction decided (ADR 0068), the open questions below gate the first step · **Updated:** 2026-11-24

Where a team keeps what its business knows, as documents people and agents
maintain together: Markdown in a tree of folders, owned by the team and
readable by it, read by every member's agent as context with its sources
cited, and changed by an agent only as a proposal a person accepts. It is a
module of its own beside [pages](pages.md), which are for showing work
([ADR 0068](../adr/0068-knowledge-is-its-own-module.md)).

## Goal

The smallest useful version, on a self-hosted server as on the hosted one:

- an admin creates a folder of documents for the team (a glossary, the
  product's rules, a runbook) by writing them, or by asking an agent;
- any member's agent, in a session on their own computer or a cloud
  computer, finds and reads those documents without being pointed at them,
  and cites the document and heading its answer rests on;
- an agent that learns something new proposes a change to a document; a
  person who may edit it sees the difference and accepts or declines it, and
  only an accepted change becomes a new version;
- a member who may not read a folder never sees it, in the console or in
  their agent's context.

## Non-goals

- **A general document editor.** No blocks, databases, embeds or real-time
  co-editing; teams that want them keep Lark or Notion, and knowledge may be
  imported from them later. What it does better is being read and kept true
  by agents.
- **Rich media.** A report, a deck or a dashboard is a [page](pages.md); a
  document may link to one.
- **Knowledge extracted from sessions without a person.** An agent proposes;
  it never writes a document directly.
- **Anyone outside the team**, as for pages.

## Shape

- **A document** is one Markdown file with a title, in a folder of the
  team's tree, versioned like a page (numbered, immutable, with author and
  note) and stored through the same object store.
- **Reading** is the team by default; a folder can be narrowed to chosen
  members. Who may edit is the open question below.
- **An agent's change is a proposal**: the document, the version it starts
  from and the new text. It goes through the same kind of review as a
  member's preset submission ([team assistant](team-assistant.md),
  "Submissions and approval"), and a proposal on a stale version is shown as
  stale rather than merged.
- **Agents read a local copy.** The plugin syncs the documents its member
  may read into a read-only folder beside its cache, as it syncs
  `GET /api/configs`, so an agent searches and reads them with its own file
  tools and the server needs no search index to serve agents. The console,
  the phone app and the hosted edition's Lark bot search on the server,
  later.
- **Citations** name the document, its version and a heading, and open in the
  console at that heading.

## Order of work

1. **Spike, thrown away:** sync a few hundred documents into a real DSH
   session's folder and measure whether its agent finds and cites the right
   one without a search tool; and how large a team's knowledge can grow
   before a local copy stops being reasonable. If it fails, step 2 adds a
   search tool on the server before anything else.
2. **Documents and folders** on the server, written and edited in the
   console (save is a new version), and synced to the plugin.
3. **Proposals and review**: the plugin's tool to propose a change, the
   review screen with the difference, accepted proposals as versions.
4. **Server search** for the console and the phone app.
5. **Imports and bots** (hosted edition): Lark documents imported, and the
   Lark bot answering from knowledge with citations.

## Open questions

- **Who may edit a document directly**: every member, the folder's chosen
  editors, or the roles the hosted edition plans (admin, editor, viewer).
- **Which edition has what**: the documents, folders and sync are what one
  team needs, so the community edition; whether review, roles and imports
  are closed.
- **Team memory** (hosted positioning, question 4): whether the team's
  memory is this module, kept by people and proposed by agents, or a store
  of its own.

## How done is verified

- **Go tests on every dialect**: a member reads only the folders that admit
  them, through the API and through the plugin's sync; a proposal never
  changes a document until it is accepted; an accepted proposal on a stale
  version is refused.
- **End to end** (`server/e2e`): a real DSH session reads a synced document,
  cites it, and proposes a change that a second account accepts.
