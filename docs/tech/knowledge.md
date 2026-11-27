# Knowledge

> **Status:** Current — the first version, the richer format and working together are built; later steps are plan · **Updated:** 2026-11-25

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
  "Knowledge" (in Chinese "knowledge documents"). Package `knowledge`, tables
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
  is the slug of the nearest heading above the fact (lower case, spaces as
  hyphens); the console opens it at
  `/teams/{teamId}/knowledge/{documentId}?version={n}#{anchor}`.

## Format

**The rule: every feature has a plain-text form in the file that still reads
when it is not rendered.** People see formatted text; an agent reads the
same file as text, with nothing hidden from it and nothing to convert. A
feature that cannot be written that way is a non-goal, not a later step. The
extended syntax follows Obsidian's conventions rather than one of our own,
since people and agents already know them.

| Feature | In the file | What a person sees | Status |
| --- | --- | --- | --- |
| Headings, lists, tables, code, quotes, task lists | GitHub-flavoured Markdown | Formatted text | Built |
| Images and attachments | `![[diagram.png]]` embeds an image, `[[spec.pdf]]` links a file, by the attachment's name (see "Architecture") | The image; a file card | Built |
| Links between documents | `[[Document]]` or `[[Document#Heading]]` | A link | Built |
| Callouts and folding | `> [!warning] Title`; `-` after the kind folds it until opened, `+` lets it fold | A box coloured by its kind; a collapsible one | Built |
| Diagrams | a `mermaid` code block | The diagram; an agent reads and edits its source | Built |
| Properties | YAML front matter: `owner` (a member, `@[Name](member-id)`), `status`, `tags`, `summary` | A row of properties under the title | Built |
| Templates | ordinary documents in the folder a space names for them; `{{title}}` and `{{date}}` are filled in | A choice when creating a document | Built |
| Backlinks | computed from links | The documents linking here, at the foot | Built |
| Mentions | `@[Name](member-id)` | Pick by display name or email. The saved ID is the account ID. Mentions lists the documents naming the reader | Built |
| A folder as a table | the front matter of its documents | A table, filtered and sorted by property | Built |
| An embedded artifact | `![[artifact:ID]]` | The artifact's card, opened only by those it is shared with | Built |
| Comments | not in the file: kept beside the version, anchored to the words they quote | Threads beside the text, their words marked | Built |

**Headings are stable anchors**, so a citation names the document, its
version and a heading, and still opens there after an edit elsewhere.

**Editing** is a WYSIWYG editor that reads and writes the Markdown above, with
a slash menu for its blocks; there is no source mode to learn. It is
Milkdown, which keeps Markdown as its model; front matter is split off
before the editor opens a document and put back on save, and `[[links]]`
are a node of their own. The first save of a document written elsewhere
normalises its syntax (table padding, list markers, escaping, hard breaks),
recorded as a version of its own with the note "formatting"; every later
save changes only what the person changed. Typing `/` on an empty line
lists the blocks to insert; properties are a form above the text that
rewrites only the front matter keys that changed. Saving is a new version. There is no real-time co-editing: an open editor shows who
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
      │
      ▼
the database (knowledge_*), the text of every version included
      ▲
      │  GET /api/knowledge, GET …/knowledge/documents/{id},
      │  POST …/knowledge/documents/{id}/proposals   (plugin or computer token)
dsh-teamwork      the plugin: KnowledgeSync writes the local copy;
                  the teamwork_knowledge tool proposes; the session's
                  system prompt tells the agent where the copy is and how to cite
```

- **`server/internal/knowledge`** is a service beside `internal/artifacts`,
  over the database and `team.Service`, which re-reads the caller's
  membership on every request. Nothing in it is shared with `artifacts` by
  import. A caller is `Agent` when it holds a plugin or computer token: such
  a caller reads and proposes, and every other change answers
  `knowledge_agent_proposes`.
- **The schema** (`internal/db/schema/knowledge.go`), ids nanoids set by the
  application, each table `Base`. A version's text is a column: at most
  1 MiB, and the copy and the console read it whole.

  | Table | Holds |
  | --- | --- |
  | `knowledge_spaces` | `team_id`, `name` (unique in the team), `reading` (`team`, `members`), `created_by`, `templates_folder_id` (one of its folders, or empty) |
  | `knowledge_space_members` | `space_id`, `user_id`, `role` (`reader`, `editor`); readers kept only while `reading` is `members`, editors always |
  | `knowledge_folders` | `space_id`, `parent_id` (empty at the space's root), `name`, unique among its siblings |
  | `knowledge_documents` | `team_id`, `space_id`, `folder_id`, `title` (unique in its folder), `current_version` (moved by a conditional update), `updated_at` |
  | `knowledge_versions` | `document_id`, `number`, `author_id`, `source` (`console`, `agent`), `computer` and `session_id` (an agent's accepted proposal's), `note`, `text` |
  | `knowledge_attachments` | `team_id`, `document_id`, `name` (unique in its document), `content_type`, `size`, `digest` (its object), `created_by` |
  | `knowledge_comments` | `team_id`, `document_id`, `parent_id` (empty for a thread's first), `author_id`, `version`, `quote`, `anchor` (the heading's slug), `body`, `resolved_by`, `resolved_at` |
  | `knowledge_proposals` | `team_id`, `document_id`, `base_version`, `author_id`, `source`, `computer`, `session_id`, `note`, `text`, `state`, `decided_by`, `decided_at`, `reason`, and the `version` an acceptance made |

  A team's deletion removes all of it (`internal/team/account.go`); an
  account's removes the member's places in spaces.
- **Routes** (`internal/httpapi/knowledge_routes.go`, all in
  `api/openapi.yaml`, JSON bodies):

  | Route | Who | What |
  | --- | --- | --- |
  | `GET /api/teams/{teamId}/knowledge` | member, or their plugin | The spaces the caller reads, with their folders and documents |
  | `POST …/knowledge/spaces`; `PATCH`, `DELETE …/spaces/{id}` | the team's admin creates; an editor renames, names the templates folder, and deletes | Deleting the templates folder clears it |
  | `GET`, `PUT …/knowledge/spaces/{id}/access` | editor | Reading, readers and editors, replaced at once |
  | `POST …/knowledge/folders`; `PATCH`, `DELETE …/folders/{id}` | editor | A folder is deleted only empty |
  | `POST …/knowledge/documents` | editor | A new document and its version 1 |
  | `GET …/knowledge/documents/{id}?version=` | reader, or their plugin | The document, its versions, the text of one (the current one by default), and its backlinks: the documents the caller reads whose current text links to it, resolved by title as the console resolves a link (`internal/knowledge/links.go`) |
  | `POST …/knowledge/documents/{id}/versions` | editor, never an agent | A new version on `baseVersion`; a stale one is `knowledge_stale` |
  | `PATCH`, `DELETE …/knowledge/documents/{id}` | editor | Rename, move within its space, delete |
  | `POST …/knowledge/documents/{id}/versions/{n}/restore` | editor | A new version copying `n` |
  | `POST …/knowledge/documents/{id}/proposals` | reader, or their plugin | A proposal on `baseVersion` |
  | `GET …/knowledge/proposals?state=`, `GET …/proposals/{id}` | member | Proposals to the spaces the caller edits, and their own; one with its text and its base's |
  | `POST …/knowledge/proposals/{id}/accept`, `…/decline`, `…/withdraw` | editor; withdraw, its author | Accepting a stale proposal is `knowledge_stale` and leaves it pending |
  | `POST …/knowledge/documents/{id}/attachments` | reader, or their plugin | One file (multipart, part `file`); the same name and bytes again is 200, other bytes `knowledge_name_taken` |
  | `GET …/knowledge/documents/{id}/attachments/{name}` | reader, or their plugin | Its bytes, sandboxed; an image or PDF inline, anything else downloaded |
  | `GET …/knowledge/search?q=` | member | The documents the caller reads whose title or current text holds `q`, with the line found, title matches first, at most 30 |
  | `GET …/knowledge/mentions` | member | The documents the caller reads whose current text mentions them |
  | `GET …/knowledge/spaces/{id}/documents?folderId=` | reader | The documents directly in a folder, or at the root, with their front matter, for a table |
  | `GET`, `POST …/knowledge/documents/{id}/comments` | reader, never an agent | Every comment, oldest first; a new thread on a quote of a version, or a reply |
  | `PATCH`, `DELETE …/knowledge/comments/{id}` | the thread's author or an editor | Resolve or reopen a thread; delete a comment, a thread with its replies |
  | `GET /api/knowledge` | plugin or computer token | The sync manifest, every team the token reaches |

  Errors are `wire.Error` codes: `knowledge_not_found` (404, also for what
  the caller may not read), `knowledge_not_editor` and
  `knowledge_agent_proposes` (403), `knowledge_stale`,
  `knowledge_name_taken`, `knowledge_folder_not_empty` and
  `knowledge_proposal_decided` and `knowledge_comment_reply` (409),
  `knowledge_too_large` (413),
  `knowledge_member_not_in_team` (400).
- **The sync manifest** is the one format other machines keep, so it is the
  part most expensive to change: per team, each space the member reads and
  each document in it, with its id, the folder names above it, its title and
  its current version. The plugin (`src/knowledge-sync.ts`) keeps
  `<cache>.knowledge.json`, which version of each document is on disk and
  where, fetches only new and changed documents, six at a time, and writes
  them atomically into `teamwork-knowledge/{team}/{space}/{folder…}/{title}.md`
  beside its cache (`~/.dsh/dsh-teamwork/teamwork-knowledge` by default),
  every file read-only, its first front matter line
  `knowledge: {documentId}@{version}`. Names are made safe on every file
  system, and two that still collide get the document's id. A renamed or
  moved document is moved; what the member no longer reads, and anything the
  state does not name, is deleted. It runs in the configuration sync's
  flight (`ConfigSync`), and its failure never fails that sync; signing out
  removes the copy and its state.
- **The plugin's tool** `teamwork_knowledge` (`src/knowledge-tool.ts`) has
  one action, `propose`: `documentId`, `baseVersion`, a one-line `note`, and
  `content` or a `path` inside the session's folder (followed links
  included, at most 1 MiB). It strips the `knowledge:` line, and refuses one
  naming another document or version. A stale proposal is answered with the
  current version and its text, for the agent to reapply. It has no action
  that writes a version or changes access. Reading needs no tool: a system
  prompt section in every session (`knowledgeGuide` in
  `src/preset-context.ts`) names the copy's absolute path, says it is
  read-only, to grep it rather than list it, to cite, to name a conflict and
  an answer it does not hold, and to change a document only by proposing,
  and calls the documents "documents (pages)".
- **The console** adds `knowledge` to Workspace's sections
  (`components/team/console-shell.tsx`), with the spaces the reader reads
  folded out beneath it as they are under My DSH; the knowledge page tells
  the sidebar which is open (`lib/knowledge-nav.ts`). Knowledge opens on an
  overview of the spaces, a space on its own page and its tree alone; the
  admin creates a space from the sidebar or the overview. Its pages are under
  `apps/web/src/pages/team/knowledge/`, and its words under `knowledge.*` in
  both locales. The editor is one component, `KnowledgeEditor`, over
  Milkdown (`@milkdown/kit` with its commonmark and gfm presets), loaded
  with the knowledge page alone; it reads and writes Markdown and nothing
  else. Callouts and diagrams are `components/knowledge-blocks.ts`: a
  callout is a node read from its quote and written back as one, and a
  `mermaid` block draws through Mermaid (`mermaid`, at its strict security
  level), loaded the first time a diagram is drawn. The block menu is
  `components/knowledge-slash.tsx`; properties are read and written with
  `yaml` (`@dsh-teamwork/shared/knowledge-properties`), which keeps every other key and
  comment as written. Rendering is the console's, never the server's: a document's text is
  never HTML, so it needs no sandbox origin.
- **Attachments** belong to a document, which names them by name in the
  Obsidian form: `![[diagram.png]]` embeds an image, `[[spec.pdf]]` links a
  file, and an extension the server allows (png, jpg, gif, webp, avif, svg,
  pdf, txt, csv, json, docx, xlsx, pptx, zip) tells one from a link to a
  document. A name, once uploaded, keeps its bytes for the document's life,
  so every version shows what it showed, and renaming or moving the
  document breaks no embed. Any reader, or their agent, may upload: a file
  does nothing until an editor's version names it. The bytes are objects of
  the team, `teams/{team}/knowledge/{digest}` in the object store, held
  once however many documents name them; the last document, space or team
  that names one forgets it. They are served under a sandbox with
  `nosniff`, so an SVG's script never runs as the member viewing it. The
  manifest lists each document's attachments with their digests; the copy
  keeps them in `{title}.files/` beside the document, and the tool uploads
  the files a proposal names before proposing it.
- **Comments** (`internal/knowledge/comments.go`) are kept beside a
  document, never in its text, so they change no version and neither the
  copy nor an agent reads them. A thread quotes words of the version it was
  written on, within one block, with the slug of the heading above; the
  console marks the first place the shown version holds those words and
  lists a thread whose words are gone as about another version. Any reader
  comments, an agent never; a thread's author or an editor resolves it, and
  a comment's author or an editor deletes it, a thread with its replies.
  Deleting a document, a space, a team or an account takes the comments
  with it, an account's threads with their replies.
- **Search** (`internal/knowledge/find.go`) is the console's: the documents a
  member reads whose title or current text holds the words, ignoring case,
  with the line found and the heading above it. It scans the current
  versions with no index, enough for a team of a few thousand documents;
  agents search their synced copy instead. Mentions are found the same way,
  by the member's id in a mention.
- **Limits** (constants, cheap to change): a document's text 1 MiB, an
  attachment 20 MiB, a team's attachments 2 GiB, counted apart from its
  artifacts.

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
- **Editions**: everything in this plan's first four steps is the community
  edition's, review included, since one team needs all of it to let agents
  write safely. What a company needs is closed: Lark imports and the Lark
  bot, the organisation's roles and directory, audit and its export,
  notifications delivered by push or email
  ([ADR 0062](../adr/0062-only-an-edition-delivers-notifications.md)), and
  semantic search on hosted models.

## Order of work

1. **Two spikes, thrown away (done 2026-11-24).** Their code stayed out of
   every repository.
   - **Local sync passes; the first version needs no server search.** A
     DeepSeek-generated knowledge base of a fictional 80-person company
     (6 spaces, 305 Chinese documents with deliberately close facts) was
     laid out as the plugin would sync it, and a real DSH headless agent
     (`deepseek-flash`), told only where the copy is and how to cite,
     answered 24 paraphrased questions and 3 the base cannot answer. It
     answered 21 correctly and 1 in part, and cited the right document for
     23. The 2 it got "wrong" were the base contradicting itself (a 7-day
     and a 30-day cooling-off period in two documents); it cited the other
     document and named the conflict. All 3 unanswerable questions were
     declined, none invented. A question took a median of 12 tool calls,
     29 seconds and 130k input tokens, mostly cached.
   - **Size is a cost, not a limit.** At ten times the size (3050
     documents) the same 10 questions were all answered and cited
     correctly, at about twice the tool calls, 2.7 times the time and 4
     times the input tokens. `grep` stays under 0.1 seconds even at 15250
     documents (26 MB); what grows is what the agent reads. A generated
     `INDEX.md` per team (paths and headings) saved only about a fifth of
     the tokens and missed one answer, so it is left out. Server search
     waits for the console, the phone and the Lark bot, or a team past a
     few thousand documents.
   - **Milkdown round-trips; TipTap does not.** Six real-style documents
     covering every first-version feature, plus messy formatting, were
     loaded, one paragraph typed into, and saved, in Milkdown 7.23 and
     TipTap 3.35 with `@tiptap/markdown`. Out of the box both destroy
     front matter and escape `[[links]]`. Milkdown, with front matter kept
     outside the editor (a few lines) and a wikilink node (about 35 lines),
     loses nothing: its first save only normalises syntax, and every second
     save is exactly the typed paragraph. TipTap, after four such fixes,
     still merges adjacent lists into one and keeps drifting on later
     saves. Minified, Milkdown is about 140 kB gzip, TipTap 163 kB.
   - **What the base contradicting itself means.** Agents surface conflicts
     well, so a conflict is a signal worth keeping: review dates
     ("After these") are the remedy, and the first version's preset
     context tells the agent to name a conflict rather than pick a side
     silently.
2. **The first version (built 2026-11-24)**: spaces
   with their readers and editors, and folders; documents and versions,
   with comparison and restore; the Milkdown editor with the first
   version's features, front matter kept outside it and `[[links]]`
   resolved by title; finding by title; the plugin's sync and citations;
   proposals from members and agents, and the review screen with the
   difference; attachments, named by name, kept beside the document in the
   copy, and attached by the editor, a paste, a drop or the agent's tool.
3. **Richer format (built 2026-11-24)**: callouts and folding, diagrams,
   properties, templates and backlinks, and the slash menu to insert blocks.
4. **Working together (built 2026-11-24)**: mentions and the reader's
   Mentions, comments beside the text, a folder as a table, embedded
   artifacts, and full-text search in the console. The phone app has no
   knowledge yet; its search comes with it.

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

None gates the first version. The spikes settled both of its unknowns: no
server-side search tool, and Milkdown with a one-time normalisation. Still
to decide when it is built: how a `[[link]]`, an atom in the editor, is
edited in place.

## How done is verified

- **Go tests on every dialect**: a member reads only the spaces that admit
  them, through the API and through the plugin's sync; a non-editor's save
  and every agent's change are proposals, and neither changes a document
  until an editor accepts it; an accepted proposal on a stale version is
  refused; a member who left the team reads and proposes nothing.
- **The format**: every built feature survives a round trip through the
  editor unchanged (a fixture of each, callouts and diagrams included,
  `components/knowledge-editor.test.tsx`), properties change only their own
  keys, and a rendered document and its raw file say the same thing to a
  reader who reads only the file.
- **Comments and search**: Go tests on every dialect that a thread, its
  replies and its resolution follow its document's access and deletion, that
  an agent comments nothing, and that search and mentions reach only the
  spaces a member reads.
- **End to end** (`server/e2e`): a real DSH session reads a synced document,
  cites it, and proposes a change that a second account accepts.
