# Artifacts

> **Status:** Plan · **Updated:** 2026-11-18

How a page an agent makes in a DSH session becomes something the team can
open, keep and improve: the agent publishes it with a plugin tool, the server
stores it as versioned files under the team, and the console shows it beside
the conversation that made it, served from an origin of its own so its
scripts can never act as the person viewing it. An artifact is private,
shared with chosen members, or open to the whole team, and never to anyone
outside it, in any edition. Every edition has it; the hosted edition adds the
phone app.

## The route in one paragraph

A plugin tool, `teamwork_artifact`, lets the agent create an artifact or add a
version to one: an HTML page with its supporting files, a Markdown document or
an SVG. The plugin uploads the files at once with the token it already holds,
so an artifact is on the server the moment it is made, private to the member
whose session made it, and reachable from any device even when that computer
is off. The tool's result is small (the id, the version, the title), and the
clients read it out of the conversation as an artifact card; opening the card
asks the server for a short-lived view address and loads it in a frame beside
the conversation on the web, or full screen in the app. The owner shares it
with chosen members or with the whole team, after which each of them can open
it and, from their own session, add a version to it. Bytes live in the server's object
store, rows in the open schema; nothing about it needs a closed package.

## Goal

The smallest useful version works end to end, on a self-hosted server as on
the hosted one:

- in a session on My DSH or Team DSH, the agent makes a page; a card appears
  in the conversation, and clicking it shows the rendered page beside it;
- the member asks for a change; the same artifact gains version 2, and the
  viewer can step back to version 1;
- the member shares it with one teammate; that teammate finds it under
  **Shared with me**, opens it, and from their own session asks their agent
  to change it, which adds version 3 under their name; a third member sees
  nothing until the owner opens it to the whole team;
- a page that tries to read the viewer's session, call the API or reach a host
  outside the allow-list fails.

## Non-goals of this plan

- **Anyone outside the team, in any edition.** No public link, no link for
  a guest, no copy to another team: every reader is a signed-in member of the
  artifact's team, re-checked on every request. A team's work stays the
  team's, which is the product's promise (the retained layer), and serving
  untrusted pages to the open internet would need a domain of its own for
  them and a way to take down what is abused. The ADR for the view address
  records this as a decision, so it is not reopened as a small feature.
- **A runtime inside the page.** No calls to a team model, no stored state, no
  "who is viewing", no comments, in this plan. Each is a capability the page is
  granted through the gateway or the API, with its own budget and audit
  questions; they come after the static version is in use.
- **JSX compiled for the author.** An agent that wants React writes an HTML
  page that loads it from an allowed CDN. A build step on the server is a
  second product.
- **Editing in the browser.** Changes are made by an agent in a session, so
  every version has a session behind it. The console views, shares, restores
  and deletes.
- **Storing the session.** Only what the agent deliberately publishes through
  the tool reaches the server; the conversation around it stays where it is
  today (an exception to the relay's "storing session content", written as an
  ADR with the first code).
- **A web host.** Size limits are a page's, not a site's, and nothing runs on
  the server.

## Terms

- **Artifact**: a titled, versioned thing one team owns, of one kind:
  `html` (an entry `index.html` and its files), `markdown` or `svg`.
- **Version**: an immutable set of files, numbered from 1, with its author
  and the session it came from.
- **Sharing**: one of three, set on the artifact:
  - `private`, **the default**, for every artifact however it is made: its
    owner (and the team's admins, an open question below);
  - `members`: its owner and the members of its team the owner chose;
  - `team`: every member of its team.
- **Reader**: anyone the sharing admits who is a member of the team now.
- **View address**: a URL that serves one version's files for an hour to
  whoever holds it, minted for a viewer who may read that version.

The codebase already says "artifact" for plugin archives
(`server/internal/artifactstore`, `ARTIFACT_STORAGE_*`, ADRs 0033, 0034 and
0042). See "Open questions".

## Where an artifact comes from

- **The tool.** `teamwork_artifact` takes `action` (`create`, `update`,
  `open`), a title, a kind, and either inline content or paths in the
  session's folder; `update` names the artifact and the version it starts from
  (`baseVersion`). `open` writes an artifact's current files into the session's
  folder, so an agent can change a teammate's page. The result carries no
  content: `fitFrame` would cut it, and the card needs only the id.
- **The tool never changes sharing.** An artifact is made `private`; only a
  person, in the console or the app, shares it. A page or a file the agent
  read could otherwise tell it to share what it should not.
- **Which team.** The team of the session's active preset, as the other
  `teamwork_*` tools already decide it; with no team preset, the member's only
  team; otherwise the tool refuses and lists the member's teams for the agent
  to name one.
- **Who owns it.** A plugin token's member, or a computer token's (the hosted
  edition's cloud sessions). A Team DSH holds a host token and no person, so
  its plugin names the session's starter from its roster
  ([shared-dsh.md](shared-dsh.md), "Sessions belong to their starter"); the
  server accepts only a member of the token's team and records the host
  beside them. The host is the team's own machine, which already decides who
  starts a session there.
- **Conflicts.** A version is accepted only on top of the current one: an
  `update` whose `baseVersion` is older is `409 artifact_stale`, and the tool
  tells the agent to `open` and reapply. Two teammates' agents never overwrite
  each other silently.

## How it is shown

The one rule: **an artifact's scripts run in an opaque origin and never hold
a credential.**

- **The view address is a capability**, not a session. The console (cookie) or
  the app (Bearer) calls `POST /api/teams/{teamId}/artifacts/{id}/versions/{n}/view`;
  the server re-reads membership and sharing and returns
  `/a/{token}/` with a token sealed under its own key from `AUTH_SECRET`: one
  version, one viewer, one hour. Relative paths in the page resolve under it,
  so supporting files load with no cookie at all.
- **Where `/a/` is served: `CONTENT_URL`**, an origin of its own when one is
  set, else `APP_URL`'s. The hosted service sets `https://dshteam.work`, a
  domain registered for nothing else, so a page is not merely an opaque
  origin but another site: the console's cookies are host-only on
  `APP_URL` and never sent there, a page cannot pass for the console in the
  address bar, and a browser or WebView that ignored the sandbox still could
  not reach the console. A self-hosted server needs no second domain and
  relies on the sandbox alone. When the two differ, `CONTENT_URL`'s host
  answers `/a/` and nothing else (no API, no console, no cookie, a
  `robots.txt` that refuses every crawler, a 404 elsewhere), and `APP_URL`'s
  host answers `/a/` with a 404. It must be a different site from `APP_URL`,
  not a subdomain of it, which would share its cookies' site: the server
  refuses to start on one. The view address is absolute, on `CONTENT_URL`.
- **`/a/` re-checks the reader on every request**, not only when the address
  is minted: a member removed from the list or the team, or an artifact made
  private, stops loading at once, even in a page already open.
- **Everything under `/a/` is sandboxed by its headers**:
  `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms`
  (no `allow-same-origin`), a `default-src 'none'` policy that admits the
  page's own files, inline script and style, `data:` and `blob:` images, and
  scripts and styles from a fixed CDN list (cdnjs, jsdelivr, unpkg),
  `connect-src` limited to the same list, `frame-ancestors` limited to
  `APP_URL` (and the app's WebView, which loads it as a top-level page),
  `X-Content-Type-Options: nosniff`, and no cookie set or read. Opened directly in a tab, the page is still an
  opaque origin, so it cannot read the console's storage or call the API as
  the viewer, and registers no service worker.
- **Markdown and SVG** go through the same address; Markdown is rendered into
  an HTML file at upload, so there is one way to serve.
- **In the console**, the conversation reads a `teamwork_artifact` result into
  an `artifact` item (`packages/relay-client`, `dsh.ts`), shown as a card. On
  a wide screen the card opens a fourth column beside the conversation: the
  frame, the title, the version picker, **Share**, **Open in a new
  tab** and **Copy link** (to the console's page, never the view address); on
  a narrow one it covers the conversation, with a way back.
- **The sidebar's Artifacts entry** ("In the console's sidebar" below) is
  where an artifact is found again away from its session.

### In the console's sidebar

**Workspace gains Artifacts, for everyone in every team, with two lists: the
reader's own, and those teammates shared with them, whether by name or with the
whole team.**

- **Where**: `GROUPS`' `work` group in
  `apps/web/src/components/team/console-shell.tsx`, after Team DSH, so the
  group reads as the places a member works and then what that work made.
  Always listed, unlike My DSH: a member with none sees how to make one (ask
  the agent in a session), which is the entry's first use.
- **Routes**: `/teams/{teamId}/artifacts` opens **Mine**;
  `?list=shared` opens **Shared with me**; `/teams/{teamId}/artifacts/{id}`
  keeps the entry selected (`within`). The page fills the area beside the
  sidebar (`fill`), in two columns as My DSH lays out its own: the list, and
  the viewer of the open one.
- **Mine**: every artifact of this team the reader owns, newest version
  first, each marked **Private**, **N members** or **Team**.
- **Shared with me**: every artifact of this team someone else owns that
  names the reader or is open to the team, newest version first, with the
  owner, how it reached the reader (**You** or **Team**), and the reader's own
  version count where they added one. A teammate's private artifact is never
  listed here, admins included; whether an admin may open one is the open
  question below.
- **A row** shows the title, the kind, who made the newest version and when.
  A filter by title runs over the loaded list; search over content is not in
  this plan.
- **The viewer** is the column the conversation opens, plus what only this
  page offers: the versions with author, date and session (a link to that
  session where the reader can open it on My DSH or Team DSH), **Share** for
  the owner and the team's admins, **Restore** on an older version, and
  **Delete**.
- **Share** is one dialog with the three choices: **Only me**, **Specific
  members** (a picker over this team's members, by name or email, the chosen
  ones listed with a way to remove each) and **Everyone in the team**. Readers
  see who else can read: the owner, and the chosen members or "the team".
  Nobody is notified in this plan; the artifact appears under their **Shared
  with me**.
- **The server**: `GET /api/teams/{teamId}/artifacts?list=mine|shared`, the
  same rule for both lists as the page says, paged by the newest version's
  time. The team's home and the teams page gain nothing.
- **Words** (`team.nav.artifacts`, `artifacts.*`) in both locales' messages.
  English says **Artifacts**. Chinese says **page**, the everyday word for a
  web page, throughout (the entry, "my pages", the card, the Share dialog):
  an artifact here is a page a teammate made to pass on a report, a deck or a
  dashboard, and the words for "work" or "deliverable" promise something
  finished for outside eyes; "task" is taken by the plugin's task lists.
- **The hosted edition's clients** (its cloud sessions on the web, and the
  phone app) read the same item from the same package and mint the same view
  address.

## The server

- **Tables** (`server/internal/db/schema`, one migration, three dialects):
  - `artifacts`: id, team, owner, host (nullable), kind, title, sharing
    (`private`, `members` or `team`), current version, deleted time;
  - `artifact_members`: artifact, member, who added them, created time;
    `(artifact, member)` unique. Rows exist only while sharing is `members`:
    changing to `private` or `team` deletes them in the same transaction, so a
    list never comes back by surprise;
  - `artifact_versions`: artifact, number (unique per artifact), author,
    host, the session id and computer the plugin reported (opaque strings),
    total size, created time;
  - `artifact_files`: version, path, content type, size, SHA-256.
- **Bytes** go in the server's object store, one object per distinct file,
  keyed by its SHA-256 under the team, so versions that share files store them
  once. Deleting an artifact deletes its rows, then each file of that team no
  row still names. A management process opens no store and serves no
  artifact.
- **Routes** (`internal/httpapi`, in `api/openapi.yaml`):
  - `POST /api/teams/{teamId}/artifacts` and `…/{id}/versions`, multipart,
    from a plugin, computer or host token (`requirePlugin` gains these
    routes);
  - `GET /api/teams/{teamId}/artifacts?list=mine|shared`, `…/{id}`, `PATCH …/{id}`
    (title), `PUT …/{id}/sharing` (`{ mode, members? }`, the whole list at
    once, so two dialogs cannot half-merge), `DELETE …/{id}`, `POST …/{id}/versions/{n}/restore` (a new
    version copying an old one), from a session;
  - `POST …/versions/{n}/view`, from a session or the app's token;
  - `GET /a/{token}/{path}` on `CONTENT_URL`, from no one in particular.
- **Rules** (`internal/team`, beside the others): the owner and the team's
  admins change sharing, restore and delete; every reader may add a version
  (a read-only reader is not in this plan); a chosen member must be in the
  team when chosen, and one who leaves it reads nothing, though their row
  stays until the list changes; a removed member is refused on their next
  request, as everywhere; an artifact the caller may not read is a 404, never
  a 403, so its existence is not told.
- **Limits**: 16 MiB and 255 files a version, 5 MiB a file, paths without `..`
  or a leading `/`. A team's total is an open question.

## What is added, and where it lives

| Piece | Where | Edition |
| --- | --- | --- |
| Tables, rules, routes, `/a/` serving | `server/internal/db/schema`, `internal/team`, `internal/httpapi`, `internal/web` | Open |
| `teamwork_artifact` and its upload | the plugin repository (`src/assistant-tools.ts`, `src/client.ts`) | Open |
| The artifact item | `packages/relay-client` (`dsh.ts`, `conversation.ts`) | Open |
| The card, the column and the Artifacts page | `apps/web` (`dsh-session.tsx`, a new `pages/team/artifacts.tsx`) | Open |
| The phone's viewer and its Share, cloud sessions' card | where `premium/` exists | Closed |

## What is expensive to change

- **The view address, its headers and its domain.** They are the security
  boundary; a hole there is every viewer's account. On the hosted service,
  `dshteam.work` is in every view address once pages are open in a tab, so
  it is kept registered for as long as the service runs.
- **The tool's arguments and the upload's shape.** An installed plugin is a
  client this repository cannot update.
- **The object keys.** Once a bucket holds team files under them, moving them
  is a migration of the bucket (ADR 0042).
- **Uploading at creation.** Changing to "upload when shared" later strands
  every client that assumes an artifact can be opened anywhere.

## Order of work, and what gates what

1. **Spike, thrown away: the isolation.** A page served with the headers
   above, from the address shape above, both on `APP_URL`'s origin (the
   self-hosted case) and on a second site (the hosted case), in Chrome,
   Safari, Firefox, Android's WebView and iOS's WKWebView: its
   `document.cookie`, `localStorage` and a `fetch` to `/api/me` each fail; a
   relative image, a script from jsdelivr and an inline script each work, and
   the console frames it. If a WebView will not keep the opaque origin on the
   same site, a self-hosted phone viewer changes shape before anything
   lands.
2. **Spike, thrown away: the tool's result on the wire.** A plugin tool's
   result reaches the console through the relay intact and readable as
   `tool/result` with the tool's name, both live and from `session/page`.
3. **One path, private only.** Schema and migration; the upload route for a
   plugin token; `create` and `update`; the view address and `/a/`; the card
   and the column on My DSH; the sidebar's Artifacts entry with **Mine**, so
   what a member made is found again from the first day. The ADRs for
   uploading at creation and for the view address are written with this
   commit.
4. **Sharing.** The three modes and the Share dialog, **Shared with me**,
   versions and restore, `open` in the tool, `baseVersion` conflicts, Team
   DSH's host token.
5. **The hosted edition**: the phone and cloud sessions (in its own plan).

## Open questions

- **The name clash.** Recommended: rename `server/internal/artifactstore` to
  `objectstore` before step 3, since it already stores more than plugin
  archives (ADR 0042). Whether `ARTIFACT_STORAGE_*` is renamed too is a
  self-hoster's break and the developer's call.
- **A team's storage limit**, and whether old versions expire.
- **What an admin sees.** Admins can open private artifacts above; the other
  reading is that private means the owner alone.
- **Read-only readers.** Every reader may add a version here; a per-member
  "can view" against "can edit" is added if a team asks for it.

## How done is verified

- **Go tests on every dialect** for the rules: a teammate cannot see a private
  artifact; under `members`, a chosen member reads and adds a version and an
  unchosen one gets a 404; a member who left the team reads nothing; changing
  to `team` and back starts from an empty list; the agent's tool cannot change
  sharing; another team's is a 404; a stale `baseVersion` is a 409; a deleted
  artifact's unshared files leave the store.
- **A test of the boundary**: a view address opens only its own version, not
  after its hour, not with another team's id, not once its viewer is taken
  off the list, and every `/a/` response carries the sandbox policy and sets
  no cookie; with `CONTENT_URL` set, `/a/` on `APP_URL` is a 404, the content
  host serves nothing else, and a `CONTENT_URL` on `APP_URL`'s site stops the
  server at start.
- **The plugin's end-to-end test** (`server/e2e`) makes an artifact from a
  real DSH session, adds a version, and reads both through view addresses.
- **A browser test** of step 1's checks against the real server, kept in CI,
  so a header change that reopens the origin fails the gate.
- **By hand before release**: the Goal's four steps, on the web, with two
  accounts.
