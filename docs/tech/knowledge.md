# Knowledge

> **Status:** Plan — direction decided (ADR 0068); the first step is two spikes · **Updated:** 2026-11-24

Where a team keeps what its business knows, as documents people and agents
maintain together: Markdown in a tree of folders, owned by the team and
readable by it, read by every member's agent as context with its sources
cited, and changed by an agent only as a proposal a person accepts. It is a
module of its own beside [artifacts](artifacts.md), which are for showing work
([ADR 0068](../adr/0068-knowledge-is-its-own-module.md)). The first version
holds only what is certain and what nearly every team would use; everything
else waits for real use to ask for it.

## Goal

The first version, on a self-hosted server as on the hosted one:

- an admin creates a space of documents for the team (a glossary, the
  product's rules, a runbook) by writing them, or by asking an agent;
- any member's agent, in a session on their own computer or a cloud
  computer, finds and reads those documents without being pointed at them,
  and cites the document and heading its answer rests on;
- an agent that learns something new proposes a change to a document; an
  editor of its space sees the difference and accepts or declines it, and
  only an accepted change becomes a new version;
- a member who may not read a space never sees it, in the console or in
  their agent's context.

## Non-goals

- **What has no plain-text form** (see "Format"): real-time co-editing and
  its cursors, synced or transcluded blocks, whiteboards and free canvases,
  database formulas, relations, rollups, boards and calendars, multi-column
  layout, and HTML or scripts inside a document. Teams that want them keep
  Lark or Notion; what this does better is being read and kept true by
  agents.
- **Rich media.** A report, a deck, a dashboard or anything interactive is a
  [artifact](artifacts.md); a document links to one.
- **Knowledge extracted from sessions without a person.** An agent proposes;
  it never writes a document directly, and nothing is extracted on its own.
- **Anyone outside the team**, as for artifacts.

## Terms

The names below are the code's as well as the docs', in every repository.

- **Knowledge**: the module, and a team's whole tree. The console calls it
  "Knowledge" (in Chinese "knowledge base"). Package `knowledge`, tables
  `knowledge_*`, routes under `/knowledge`.
- **Space**: a top-level folder, the one thing that carries access (readers
  and editors). A team has any number; what is below a space follows it.
- **Folder**: any folder inside a space, for order only; it carries no
  access of its own.
- **Document**: one Markdown file with a title, in a space or a folder.
  Always "document" in code, never "doc", "note" or "page"
  ([ADR 0069](../adr/0069-pages-become-artifacts.md)). To people and agents
  both words work: the plugin's tool descriptions and the preset context say
  "documents (pages)", so an agent asked for the team's page on a subject
  looks in knowledge.
- **Version**: an immutable copy of a document's text and attachments,
  numbered from 1, with its author, a one-line note, and where it came from
  (the console, or an agent's session).
- **Attachment**: a file a document links to, kept with its version.
- **Proposal**: a change to a document not yet in it: the version it starts
  from, the new text and attachments, who proposed it (a member, or a
  member's agent) and its state, `pending`, `accepted`, `declined` or
  `withdrawn`. A proposal whose starting version is no longer the current one
  is **stale**, worked out rather than stored.
- **Editor**: a member who may write a space's documents and decide its
  proposals. **Reader**: a member who may read a space and propose to it.
- **Sync**: the plugin's read-only local copy of what its member may read.
- **Citation**: `knowledge:{documentId}@{version}#{anchor}`, where the anchor
  is a heading's slug; the console opens it at
  `/teams/{teamId}/knowledge/{documentId}?version={n}#{anchor}`.

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
| An embedded artifact | `![[artifact:ID]]` | The artifact's card | Working together |
| Comments | not in the file: kept beside the version, anchored to a range | Comments in the margin | Working together |

**Headings are stable anchors**, so a citation names the document, its
version and a heading, and still opens there after an edit elsewhere.

**Editing** is a WYSIWYG editor that reads and writes the Markdown above, with
a slash menu for its blocks; there is no source mode to learn. Saving is a
new version. There is no real-time co-editing: an open editor shows who
else has the document open, and a save on a stale version is refused and
shown as a difference to reapply, as an artifact's `artifact_stale` is.

## Architecture

Four parts, each where the same concern already lives:

```
apps/web          Knowledge in Workspace: the tree, a document, the editor,
                  history and comparison, proposals to decide
      │  /api/teams/{teamId}/knowledge/*   (session)
      ▼
server/internal/knowledge   every rule: access, versions, proposals,
                  limits, the sync manifest; internal/httpapi maps routes
      │                                   │
      ▼                                   ▼
the database (knowledge_*)        artifactstore objects:
                                  teams/{team}/knowledge/{digest}
      ▲
      │  GET /api/knowledge, …/knowledge/objects/{digest},
      │  POST …/knowledge/documents/{id}/proposals   (plugin or computer token)
dsh-teamwork      the plugin: KnowledgeSync writes the local copy;
                  the teamwork_knowledge tool proposes; the preset context
                  tells the agent where the copy is and how to cite
```

- **`server/internal/knowledge`** is a service beside `internal/artifacts`, built
  the same way: the database, `artifactstore` (object kind `knowledge`,
  addressed by digest so identical attachments are stored once), and
  `team.Service` to re-read the caller's membership on every request.
  Nothing in it is shared with `artifacts` by import; what is alike is alike by
  convention.
- **The schema** (`internal/db/schema/knowledge.go`), ids nanoids set by the
  application, each table `Base`:

  | Table | Holds |
  | --- | --- |
  | `knowledge_spaces` | `team_id`, `name`, `reading` (`team`, `members`), `created_by` |
  | `knowledge_space_members` | `space_id`, `user_id`, `role` (`reader`, `editor`); readers listed only while `reading` is `members`, editors always |
  | `knowledge_folders` | `space_id`, `parent_id` (empty at the space's root), `name` |
  | `knowledge_documents` | `team_id`, `space_id`, `folder_id`, `title`, `current_version` (moved by a conditional update), `updated_at` |
  | `knowledge_versions` | `document_id`, `number`, `author_id`, `source` (`console`, `agent`), `computer`, `session_id`, `note`, `digest` (the text's object), `size` |
  | `knowledge_files` | `version_id`, `team_id`, `path`, `content_type`, `size`, `digest`: a version's attachments |
  | `knowledge_proposals` | `document_id`, `base_version`, `author_id`, `source`, `computer`, `session_id`, `note`, `digest`, `state`, `decided_by`, `decided_at`, `reason`, and the version an acceptance made |

  A proposal's attachments are `knowledge_files` rows of its own (a
  `proposal_id` beside `version_id`, exactly one set), copied onto the
  version an acceptance makes.
- **Routes** (`internal/httpapi/knowledge_routes.go`, all in
  `api/openapi.yaml`):

  | Route | Who | What |
  | --- | --- | --- |
  | `GET /api/teams/{teamId}/knowledge` | session | The spaces the caller reads, with their folders and documents |
  | `POST /api/teams/{teamId}/knowledge/spaces`, `PATCH`/`DELETE …/spaces/{id}`, `PUT …/spaces/{id}/members` | an admin creates; an editor renames, sets access, deletes | |
  | `POST …/knowledge/folders`, `PATCH`/`DELETE …/folders/{id}` | editor | |
  | `POST …/knowledge/documents` | editor | A new document and its version 1 |
  | `GET …/knowledge/documents/{id}` | reader | The document, its versions, and the text and file list of `?version=` (the current one by default) |
  | `POST …/knowledge/documents/{id}/versions` | editor | A new version on `baseVersion`; a stale one is `knowledge_stale` |
  | `PATCH`/`DELETE …/knowledge/documents/{id}` | editor | Rename, move within its space, delete |
  | `POST …/knowledge/documents/{id}/versions/{n}/restore` | editor | A new version copying `n` |
  | `POST …/knowledge/documents/{id}/proposals` | reader, or a plugin or computer token's member | A proposal on `baseVersion` |
  | `GET …/knowledge/proposals?state=pending` | session | Proposals to the spaces the caller edits, or the caller's own |
  | `POST …/knowledge/proposals/{id}/accept`, `…/decline`, `…/withdraw` | editor; withdraw, its author | Accepting a stale proposal is `knowledge_stale` |
  | `GET …/knowledge/objects/{digest}` | reader of a version naming it | One text or attachment |
  | `GET /api/knowledge` | plugin or computer token | The sync manifest, every team the token reaches |

  Uploads are `multipart/form-data` like a page's: a `meta` part (JSON), the
  text as `index.md`, and each attachment under its path. Errors are
  `wire.Error` codes: `knowledge_not_found` (404, also for what the caller
  may not read), `knowledge_not_editor` (403), `knowledge_stale` (409),
  `knowledge_too_large` (413), `knowledge_invalid` (400).
- **The sync manifest** is the one format other machines keep, so it is the
  part most expensive to change: per team, each space, folder and document
  the member may read, with its path, current version, and the digests of
  its text and attachments. The plugin fetches only digests it lacks and
  writes, replacing atomically, the tree
  `teamwork-knowledge/{team}/{space}/{folder…}/{title}.md` beside its cache,
  attachments beside each document under `{title}.files/`, every file
  read-only, and a document's id and version in its front matter as
  `knowledge: {documentId}@{version}`, which the sync adds and a
  proposal's text has removed before it is stored. What the member may no longer read is
  deleted from disk on the next sync. It runs with the configuration sync
  (`ConfigSync`, the same interval and the same single flight).
- **The plugin** gains `src/knowledge-sync.ts` (`KnowledgeSync`) and
  `src/knowledge-tool.ts`: the tool **`teamwork_knowledge`**, with one action,
  `propose` (`documentId`, `baseVersion`, `note`, and `content` or a
  `directory` with `index.md` and its attachments, read only inside the
  session's folder as `teamwork_artifact` reads). Reading needs no tool: the
  agent uses its own file tools on the copy, and the preset context
  (`src/preset-context.ts`) says where the copy is, that it is read-only,
  how to cite, and to propose rather than edit. A stale proposal is answered
  with the current version for the agent to reapply. The tool has no action
  that writes a version or changes access.
- **The console** adds `knowledge` to Workspace's sections
  (`components/team/console-shell.tsx`), its pages under
  `apps/web/src/pages/team/knowledge/`, and its words under `knowledge.*` in
  both locales. The editor is one component, `KnowledgeEditor`, whose library
  the spike chooses; it reads and writes Markdown and nothing else.
- **Rendering** is the console's, never the server's: the editor's read-only
  mode shows a document, and a document's text is never HTML, so it needs no
  sandbox origin. Its images and attachments load from
  `…/knowledge/objects/{digest}` on the member's session.
- **Limits** (constants in the package, cheap to change): a document's text
  1 MiB, an attachment 20 MiB, a version's attachments 50 MiB, and a team's
  knowledge objects 2 GiB, counted apart from its artifacts.

**Expensive to change**: the sync manifest and the local tree's layout, the
citation format, the file format's conventions (see "Format"), and the
tables. Cheap: the limits, the console's screens, the editor library.

## Rules

- **Versions**: every save of a document by an editor is a new version on
  the version it started from; a save on a stale version is refused. Every
  version can be compared with the one before it and restored.
- **Reading** is every member of the team by default; a space can be
  narrowed to chosen members. A member who left the team reads nothing, on
  the next request and on the plugin's next sync.
- **Editing** belongs to a space's editors: whoever created it and the
  team's admins, who may add other members. A reader who edits in the
  console still can; the save becomes a proposal instead of a version.
- **An agent's change is always a proposal**, even in its editor's own
  session, so no text an agent read can change a document without a person.
  An editor accepts it (a new version under the proposer's name) or declines
  it with a reason, as a member's preset submission is reviewed
  ([team assistant](team-assistant.md), "Submissions and approval"), and
  accepts their own agent's proposal in one step.
- **Agents read the synced copy** with their own file tools, so the server
  needs no search index to serve them; the console finds a document by its
  title in the first version.
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
2. **The first version**: spaces with their readers and editors, and folders; documents,
   attachments and versions, with comparison and restore; the editor with
   the first version's features; finding by title; the plugin's sync and
   citations; proposals from members and agents, and the review screen with
   the difference.
3. **Richer format**: callouts and folding, diagrams, properties, templates
   and backlinks.
4. **Working together**: mentions, comments, a folder as a table, embedded
   artifacts, and full-text search for the console and the phone app.

**After these, each designed when its turn comes**, not scheduled:

- **Review dates**: a `reviewed` property and an interval per space
  (proposed: 90 days by default, or none for stable reference); a document
  past it is marked possibly stale, an agent citing it says so, and its
  owner, or its space's editors when the owner has left, is reminded.
- **Team memory**: a space of this module that agents propose to from
  their sessions, rather than a store of its own; extraction without a
  person stays a non-goal until the acceptance rate of proposals says
  agents propose well.
- **Closed-edition work**: Lark imports and the Lark bot answering from
  knowledge with citations, the organisation's roles mapped onto space
  editors, audit, pushed and emailed notifications, semantic search.

## Open questions

None gates the first version. The spikes may change two of its parts: a
server-side search tool if local sync fails, and a one-time normalisation if
no editor round-trips cleanly.

## How done is verified

- **Go tests on every dialect**: a member reads only the spaces that admit
  them, through the API and through the plugin's sync; a non-editor's save
  and every agent's change are proposals, and neither changes a document
  until an editor accepts it; an accepted proposal on a stale version is
  refused; a member who left the team reads and proposes nothing.
- **The format**: every first-version feature survives a round trip through
  the editor unchanged (a fixture of each), and a rendered document and its
  raw file say the same thing to a reader who reads only the file.
- **End to end** (`server/e2e`): a real DSH session reads a synced document,
  cites it, and proposes a change that a second account accepts.
