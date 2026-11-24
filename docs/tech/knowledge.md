# Knowledge

> **Status:** Plan — direction decided (ADR 0068); the first step is two spikes · **Updated:** 2026-11-24

Where a team keeps what its business knows, as documents people and agents
maintain together: Markdown in a tree of folders, owned by the team and
readable by it, read by every member's agent as context with its sources
cited, and changed by an agent only as a proposal a person accepts. It is a
module of its own beside [pages](pages.md), which are for showing work
([ADR 0068](../adr/0068-knowledge-is-its-own-module.md)). The first version
holds only what is certain and what nearly every team would use; everything
else waits for real use to ask for it.

## Goal

The first version, on a self-hosted server as on the hosted one:

- an admin creates a folder of documents for the team (a glossary, the
  product's rules, a runbook) by writing them, or by asking an agent;
- any member's agent, in a session on their own computer or a cloud
  computer, finds and reads those documents without being pointed at them,
  and cites the document and heading its answer rests on;
- an agent that learns something new proposes a change to a document; an
  editor of its folder sees the difference and accepts or declines it, and
  only an accepted change becomes a new version;
- a member who may not read a folder never sees it, in the console or in
  their agent's context.

## Non-goals

- **What has no plain-text form** (see "Format"): real-time co-editing and
  its cursors, synced or transcluded blocks, whiteboards and free canvases,
  database formulas, relations, rollups, boards and calendars, multi-column
  layout, and HTML or scripts inside a document. Teams that want them keep
  Lark or Notion; what this does better is being read and kept true by
  agents.
- **Rich media.** A report, a deck, a dashboard or anything interactive is a
  [page](pages.md); a document links to one.
- **Knowledge extracted from sessions without a person.** An agent proposes;
  it never writes a document directly, and nothing is extracted on its own.
- **Anyone outside the team**, as for pages.

## Format

**The rule: every feature has a plain-text form in the file that still reads
when it is not rendered.** People see formatted text; an agent reads the
same file as text, with nothing hidden from it and nothing to convert. A
feature that cannot be written that way is a non-goal, not a later step. The
extended syntax follows Obsidian's conventions rather than one of our own,
since people and agents already know them.

| Feature | In the file | What a person sees | When |
| --- | --- | --- | --- |
| Headings, lists, tables, code, quotes, task lists | GitHub-flavoured Markdown | Formatted text | First version |
| Images and attachments | a relative link to a file kept beside the document | Inline, or a file card | First version |
| Links between documents | `[[Document]]` or `[[Document#Heading]]` | A link | First version |
| Callouts and folding | `> [!warning] Title`, `> [!note]- Title` | A coloured box; a collapsible one | Richer format |
| Diagrams | a `mermaid` code block | The diagram; an agent reads and edits its source | Richer format |
| Properties | YAML front matter: `owner`, `status`, `tags`, `summary` | A row of properties under the title | Richer format |
| Templates | ordinary documents in a templates folder | A choice when creating a document | Richer format |
| Backlinks | computed from links | The documents linking here, at the foot | Richer format |
| Mentions | `@[Name](member-id)` | A mention, listed in the console | Working together |
| A folder as a table | the front matter of its documents | A table, filtered and sorted by property | Working together |
| An embedded page | `![[page:ID]]` | The page's card | Working together |
| Comments | not in the file: kept beside the version, anchored to a range | Comments in the margin | Working together |

**Headings are stable anchors**, so a citation names the document, its
version and a heading, and still opens there after an edit elsewhere.

**Editing** is a WYSIWYG editor that reads and writes the Markdown above, with
a slash menu for its blocks; there is no source mode to learn. Saving is a
new version. There is no real-time co-editing: an open editor shows who
else has the document open, and a save on a stale version is refused and
shown as a difference to reapply, as a page's `page_stale` is.

## Shape

- **A document** is one Markdown file with a title, in a folder of the
  team's tree, versioned like a page (numbered, immutable, with author and
  note), and stored with its attachments through the same object store.
  Every version can be compared with the one before it and restored.
- **Reading** is every member of the team by default; a folder can be
  narrowed to chosen members, and what is inside follows its folder.
- **Editing** belongs to a folder's editors: whoever created it and the
  team's admins, who may add other members. A member who is not an editor
  can still edit; the save becomes a proposal instead of a version.
- **An agent's change is always a proposal**, even in its editor's own
  session, so no text an agent read can change a document without a person.
  A proposal is the document, the version it starts from and the new text;
  an editor accepts it (as a new version under the proposer's name) or
  declines it, as a member's preset submission is reviewed
  ([team assistant](team-assistant.md), "Submissions and approval"). A
  proposal on a stale version is shown as stale rather than merged. An
  editor accepts their own agent's proposal in one step.
- **Agents read a local copy.** The plugin syncs the documents its member
  may read into a read-only folder beside its cache, as it syncs
  `GET /api/configs`, so an agent searches and reads them with its own file
  tools and the server needs no search index to serve agents. The console
  finds a document by its title in the first version.
- **Citations** name the document, its version and a heading, and open in the
  console at that heading.
- **Editions**: everything in this plan's first three steps is the community
  edition's, review included, since one team needs all of it to let agents
  write safely. What a company needs is closed: Lark imports and the Lark
  bot, the organisation's roles and directory, audit and its export,
  notifications delivered by push or email
  ([ADR 0062](../adr/0062-only-an-edition-delivers-notifications.md)), and
  semantic search on hosted models.

## Order of work

1. **Two spikes, thrown away:**
   - **Local sync:** sync a few hundred documents into a real DSH session's
     folder and measure whether its agent finds and cites the right one
     without a search tool, and how large a team's knowledge can grow
     before a local copy stops being reasonable. If it fails, the first
     version adds a search tool on the server.
   - **The editor's round trip:** open real documents using every feature
     of the first version in candidate WYSIWYG editors (Milkdown, TipTap),
     edit one paragraph, save, and diff. Pass: the diff is that paragraph
     alone. If no editor passes, the editor normalises a document once on
     its first save, as a version of its own, and every later diff is
     measured from it.
2. **The first version**: folders and their readers and editors; documents,
   attachments and versions, with comparison and restore; the editor with
   the first version's features; finding by title; the plugin's sync and
   citations; proposals from members and agents, and the review screen with
   the difference.
3. **Richer format**: callouts and folding, diagrams, properties, templates
   and backlinks.
4. **Working together**: mentions, comments, a folder as a table, embedded
   pages, and full-text search for the console and the phone app.

**After these, each designed when its turn comes**, not scheduled:

- **Review dates**: a `reviewed` property and an interval per folder
  (proposed: 90 days by default, or none for stable reference); a document
  past it is marked possibly stale, an agent citing it says so, and its
  owner, or its folder's editors when the owner has left, is reminded.
- **Team memory**: a folder of this module that agents propose to from
  their sessions, rather than a store of its own; extraction without a
  person stays a non-goal until the acceptance rate of proposals says
  agents propose well.
- **Closed-edition work**: Lark imports and the Lark bot answering from
  knowledge with citations, the organisation's roles mapped onto folder
  editors, audit, pushed and emailed notifications, semantic search.

## Open questions

None gates the first version. The spikes may change two of its parts: a
server-side search tool if local sync fails, and a one-time normalisation if
no editor round-trips cleanly.

## How done is verified

- **Go tests on every dialect**: a member reads only the folders that admit
  them, through the API and through the plugin's sync; a non-editor's save
  and every agent's change are proposals, and neither changes a document
  until an editor accepts it; an accepted proposal on a stale version is
  refused; a member who left the team reads and proposes nothing.
- **The format**: every first-version feature survives a round trip through
  the editor unchanged (a fixture of each), and a rendered document and its
  raw file say the same thing to a reader who reads only the file.
- **End to end** (`server/e2e`): a real DSH session reads a synced document,
  cites it, and proposes a change that a second account accepts.
