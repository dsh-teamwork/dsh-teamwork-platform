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

- **What has no plain-text form** (see "Format"): real-time co-editing and
  its cursors, synced or transcluded blocks, whiteboards and free canvases,
  database formulas, relations, rollups, boards and calendars, multi-column
  layout, and HTML or scripts inside a document. Teams that want them keep
  Lark or Notion, and knowledge may be imported from them later; what it
  does better is being read and kept true by agents.
- **Rich media.** A report, a deck, a dashboard or anything interactive is a
  [page](pages.md); a document embeds or links to one.
- **Knowledge extracted from sessions without a person.** An agent proposes;
  it never writes a document directly.
- **Anyone outside the team**, as for pages.

## Format

**The rule: every feature has a plain-text form in the file that still reads
when it is not rendered.** People see something close to Lark or Notion; an
agent reads the same file as text, with nothing hidden from it and nothing
to convert. A feature that cannot be written that way is a non-goal, not a
later step. The extended syntax follows Obsidian's conventions rather than
one of our own, since people and agents already know them.

| Feature | In the file | What a person sees | Step |
| --- | --- | --- | --- |
| Headings, lists, tables, code, task lists | GitHub-flavoured Markdown | Formatted text | 2 |
| Callouts | `> [!warning] Title` | A coloured box | 2 |
| Folding | `> [!note]- Title` (Obsidian's folded callout) | A collapsible section | 2 |
| Diagrams | a `mermaid` code block | The diagram; an agent reads and edits its source | 2 |
| Images and attachments | a relative link to a file kept beside the document | Inline, or a file card | 2 |
| Links between documents | `[[Document]]` or `[[Document#Heading]]` | A link, and backlinks at the foot of the target | 2 |
| Properties | YAML front matter (below) | A row of properties under the title | 2 |
| Templates | ordinary documents in a templates folder | A choice when creating a document | 2 |
| Mentions | `@[Name](member-id)` | A mention, and a notification | 4 |
| A folder as a table | the front matter of its documents | A table of them, filtered and sorted by property | 4 |
| An embedded page | `![[page:ID]]` | The page's card or preview | 4 |
| Comments | not in the file: kept beside the version, anchored to a range | Comments in the margin | 5 |

**Front matter** carries what a person filters by and an agent decides by:
`owner` (a member), `status`, `tags`, `summary` (what the document says, in
a sentence or two, so an agent can decide whether to read the rest) and
`reviewed` (the date a person last confirmed it is true). A document past
its folder's review interval is marked possibly stale: an agent citing it
says so, and its owner is reminded. That is how knowledge is kept true
rather than only kept.

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

1. **Two spikes, thrown away:**
   - **Local sync:** sync a few hundred documents into a real DSH session's
     folder and measure whether its agent finds and cites the right one
     without a search tool, and how large a team's knowledge can grow
     before a local copy stops being reasonable. If it fails, step 2 adds a
     search tool on the server before anything else.
   - **The editor's round trip:** open real documents using every feature
     of step 2 in candidate WYSIWYG editors (Milkdown, TipTap), edit one
     paragraph, save, and diff. Pass: the diff is that paragraph alone. If
     no editor passes, the editor normalises a document once on its first
     save, as a version of its own, and every later diff is measured from
     it.
2. **Documents and folders**: the server's documents, folders, versions and
   attachments; the editor with step 2's features in the table above, front
   matter and the stale mark; templates; backlinks; and the plugin's sync.
3. **Proposals and review**: the plugin's tool to propose a change, the
   review screen with the difference, accepted proposals as versions.
4. **Working together**: mentions and their notifications, a folder as a
   table, embedded pages.
5. **Comments and server search**, for the console and the phone app.
6. **Imports and bots** (hosted edition): Lark documents imported, and the
   Lark bot answering from knowledge with citations.

## Open questions

- **Who may edit a document directly**: every member, the folder's chosen
  editors, or the roles the hosted edition plans (admin, editor, viewer).
- **Which edition has what**: the documents, folders and sync are what one
  team needs, so the community edition; whether review, roles and imports
  are closed.
- **The review interval**: one default for the team, or set per folder,
  and who is reminded besides the owner.
- **Team memory** (hosted positioning, question 4): whether the team's
  memory is this module, kept by people and proposed by agents, or a store
  of its own.

## How done is verified

- **Go tests on every dialect**: a member reads only the folders that admit
  them, through the API and through the plugin's sync; a proposal never
  changes a document until it is accepted; an accepted proposal on a stale
  version is refused.
- **The format**: every feature in the table survives a round trip through
  the editor unchanged (a fixture of each), and a rendered document and its
  raw file say the same thing to a reader who reads only the file.
- **End to end** (`server/e2e`): a real DSH session reads a synced document,
  cites it, and proposes a change that a second account accepts.
