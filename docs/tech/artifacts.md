# Artifacts

> **Status:** Plan · **Updated:** 2026-11-18

How a page an agent makes in a DSH session becomes something the team can
open, keep and improve: the agent publishes it with a plugin tool, the server
stores it as versioned files under the team, and the console shows it beside
the conversation that made it, served from an origin of its own so its
scripts can never act as the person viewing it. Every edition has it; the
community edition shares within a team only, and the hosted edition adds
public links and the phone app.

## The route in one paragraph

A plugin tool, `teamwork_artifact`, lets the agent create an artifact or add a
version to one: an HTML page with its supporting files, a Markdown document or
an SVG. The plugin uploads the files at once with the token it already holds,
so an artifact is on the server the moment it is made, private to the member
whose session made it, and reachable from any device even when that computer
is off. The tool's result is small (the id, the version, the title), and the
clients read it out of the conversation as an artifact card; opening the card
asks the server for a short-lived view address and loads it in a frame beside
the conversation on the web, or full screen in the app. The owner turns an
artifact to **team**, after which any member of the team can open it and,
from their own session, add a version to it. Bytes live in the server's object
store, rows in the open schema; nothing about it needs a closed package.

## Goal

The smallest useful version works end to end, on a self-hosted server as on
the hosted one:

- in a session on My DSH or Team DSH, the agent makes a page; a card appears
  in the conversation, and clicking it shows the rendered page beside it;
- the member asks for a change; the same artifact gains version 2, and the
  viewer can step back to version 1;
- the member shares it with the team; a teammate finds it on the team's
  **Artifacts** page, opens it, and from their own session asks their agent
  to change it, which adds version 3 under their name;
- a page that tries to read the viewer's session, call the API or reach a host
  outside the allow-list fails.

## Non-goals of this plan

- **Public links in the community edition.** A self-hosted server serves
  artifacts to its team's members only. Public links need a domain whose only
  job is untrusted content, which the hosted service has and a single-domain
  install does not; they are the hosted edition's, behind a team admin's
  switch.
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
- **Visibility**: `private` (its owner and the team's admins) or `team`
  (every member). The hosted edition adds `public`.
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
  the server re-reads membership and visibility and returns
  `/a/{token}/` with a token sealed under its own key from `AUTH_SECRET`: one
  version, one viewer, one hour. Relative paths in the page resolve under it,
  so supporting files load with no cookie at all.
- **Everything under `/a/` is sandboxed by its headers**:
  `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms`
  (no `allow-same-origin`), a `default-src 'none'` policy that admits the
  page's own files, inline script and style, `data:` and `blob:` images, and
  scripts and styles from a fixed CDN list (cdnjs, jsdelivr, unpkg),
  `connect-src` limited to the same list, `X-Content-Type-Options: nosniff`,
  and no cookie set or read. Opened directly in a tab, the page is still an
  opaque origin, so it cannot read the console's storage or call the API as
  the viewer, and registers no service worker.
- **Markdown and SVG** go through the same address; Markdown is rendered into
  an HTML file at upload, so there is one way to serve.
- **In the console**, the conversation reads a `teamwork_artifact` result into
  an `artifact` item (`packages/relay-client`, `dsh.ts`), shown as a card. On
  a wide screen the card opens a fourth column beside the conversation: the
  frame, the title, the version picker, **Share with team**, **Open in a new
  tab** and **Copy link** (to the console's page, never the view address); on
  a narrow one it covers the conversation, with a way back.
- **The sidebar's Artifacts entry** ("In the console's sidebar" below) is
  where an artifact is found again away from its session.

### In the console's sidebar

**Workspace gains Artifacts, for everyone in every team, with two lists: the
reader's own, and those teammates shared with the team.**

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
- **Mine**: every artifact of this team the reader owns, private or shared,
  newest version first, each marked with its visibility.
- **Shared with me**: every `team` artifact of this team someone else owns,
  newest version first, with the owner, and the reader's own version count
  where they added one. A teammate's private artifact is never listed here,
  admins included; whether an admin may open one is the open question below.
- **A row** shows the title, the kind, who made the newest version and when.
  A filter by title runs over the loaded list; search over content is not in
  this plan.
- **The viewer** is the column the conversation opens, plus what only this
  page offers: the versions with author, date and session (a link to that
  session where the reader can open it on My DSH or Team DSH), **Share with
  team** and **Make private** for the owner and the team's admins, **Restore**
  on an older version, and **Delete**.
- **The server**: `GET /api/teams/{teamId}/artifacts?list=mine|shared`, the
  same rule for both lists as the page says, paged by the newest version's
  time. The team's home and the teams page gain nothing.
- **Words** (`team.nav.artifacts`, `artifacts.*`) in both locales' messages.
- **The hosted edition's clients** (its cloud sessions on the web, and the
  phone app) read the same item from the same package and mint the same view
  address.

## The server

- **Tables** (`server/internal/db/schema`, one migration, three dialects):
  - `artifacts`: id, team, owner, host (nullable), kind, title, visibility,
    current version, deleted time;
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
  - `GET /api/teams/{teamId}/artifacts?list=mine|shared`, `…/{id}`, `PATCH …/{id}` (title,
    visibility), `DELETE …/{id}`, `POST …/{id}/versions/{n}/restore` (a new
    version copying an old one), from a session;
  - `POST …/versions/{n}/view`, from a session or the app's token;
  - `GET /a/{token}/{path}`, from no one in particular.
- **Rules** (`internal/team`, beside the others): the owner and the team's
  admins change visibility, restore and delete; any member may add a version
  to a `team` artifact; a removed member is refused on their next request, as
  everywhere; another team's artifact is a 404.
- **Limits**: 16 MiB and 255 files a version, 5 MiB a file, paths without `..`
  or a leading `/`. A team's total is an open question.

## What is added, and where it lives

| Piece | Where | Edition |
| --- | --- | --- |
| Tables, rules, routes, `/a/` serving | `server/internal/db/schema`, `internal/team`, `internal/httpapi`, `internal/web` | Open |
| `teamwork_artifact` and its upload | the plugin repository (`src/assistant-tools.ts`, `src/client.ts`) | Open |
| The artifact item | `packages/relay-client` (`dsh.ts`, `conversation.ts`) | Open |
| The card, the column and the Artifacts page | `apps/web` (`dsh-session.tsx`, a new `pages/team/artifacts.tsx`) | Open |
| Public links, the phone's viewer, cloud sessions' card | where `premium/` exists | Closed |

## What is expensive to change

- **The view address and its headers.** They are the security boundary; a
  hole there is every viewer's account.
- **The tool's arguments and the upload's shape.** An installed plugin is a
  client this repository cannot update.
- **The object keys.** Once a bucket holds team files under them, moving them
  is a migration of the bucket (ADR 0042).
- **Uploading at creation.** Changing to "upload when shared" later strands
  every client that assumes an artifact can be opened anywhere.

## Order of work, and what gates what

1. **Spike, thrown away: the isolation.** A page served with the headers
   above, from the address shape above, in Chrome, Safari, Firefox, Android's
   WebView and iOS's WKWebView: its `document.cookie`, `localStorage` and a
   `fetch` to `/api/me` each fail; a relative image, a script from jsdelivr and
   an inline script each work. If a WebView will not keep the opaque origin,
   the phone viewer changes shape before anything lands.
2. **Spike, thrown away: the tool's result on the wire.** A plugin tool's
   result reaches the console through the relay intact and readable as
   `tool/result` with the tool's name, both live and from `session/page`.
3. **One path, private only.** Schema and migration; the upload route for a
   plugin token; `create` and `update`; the view address and `/a/`; the card
   and the column on My DSH; the sidebar's Artifacts entry with **Mine**, so
   what a member made is found again from the first day. The ADRs for uploading at creation and for the
   view address are written with this commit.
4. **The team.** Visibility, **Shared with me**, versions and restore, `open`
   in the tool, `baseVersion` conflicts, Team DSH's host token.
5. **The hosted edition**: public links, the phone, cloud sessions (in its own
   plan).

## Open questions

- **The name clash.** Recommended: rename `server/internal/artifactstore` to
  `objectstore` before step 3, since it already stores more than plugin
  archives (ADR 0042). Whether `ARTIFACT_STORAGE_*` is renamed too is a
  self-hoster's break and the developer's call.
- **A team's storage limit**, and whether old versions expire.
- **What an admin sees.** Admins can open private artifacts above; the other
  reading is that private means the owner alone.
- **Copy to another team**, as Claude's remix: left out until someone asks.

## How done is verified

- **Go tests on every dialect** for the rules: a teammate cannot see a private
  artifact, another team's is a 404, a removed member is refused, a stale
  `baseVersion` is a 409, a deleted artifact's unshared files leave the store.
- **A test of the boundary**: a view address opens only its own version, not
  after its hour, not with another team's id, and every `/a/` response carries
  the sandbox policy and sets no cookie.
- **The plugin's end-to-end test** (`server/e2e`) makes an artifact from a
  real DSH session, adds a version, and reads both through view addresses.
- **A browser test** of step 1's checks against the real server, kept in CI,
  so a header change that reopens the origin fails the gate.
- **By hand before release**: the Goal's four steps, on the web, with two
  accounts.
