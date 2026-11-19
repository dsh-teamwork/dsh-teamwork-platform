# Pages

> **Status:** Plan · **Updated:** 2026-11-19

How a page an agent makes in a DSH session (a report, a deck, a dashboard, a
diagram) becomes something a team can open, keep and improve, and the order
it is built in. The agent publishes it with the teamwork plugin's
`teamwork_page` tool; the server keeps it as versioned files under the team,
private to its maker until a person shares it with chosen members or the
whole team, and never with anyone outside the team; the console shows it
beside the conversation that made it and under **Pages** in the sidebar,
served from an origin of its own (`CONTENT_URL`, `dshteam.work` on the hosted
service) in a sandbox, so its scripts can never act as the person viewing it.
Every edition has it; the hosted edition adds the phone app.

## Contents

The plan answers, in order: what it is and is not (Goal, Non-goals, Terms);
how it works (Architecture, Data model, Object storage, API, The view
address, The plugin tool, The clients, Security); how it is run (Editions,
Configuration and operations); and how it is built (Order of work, Open
questions, How done is verified).

## Goal

The smallest useful version works end to end, on a self-hosted server as on
the hosted one:

- in a session on My DSH or Team DSH, the agent makes a page; a card appears
  in the conversation, and clicking it shows the rendered page beside it;
- the member asks for a change; the page gains version 2, and the viewer can
  step back to version 1;
- the member shares it with one teammate; that teammate finds it under
  **Shared with me**, opens it, and from their own session asks their agent
  to change it, which adds version 3 under their name; a third member sees
  nothing until the owner opens it to the whole team;
- a page that tries to read the viewer's session, call the API as them or
  reach a host outside the allow-list fails.

## Non-goals

- **Anyone outside the team, in any edition.** No public link, no link for a
  guest, no copy to another team: every reader is a signed-in member of the
  page's team, re-checked on every request. A team's work stays the team's,
  and serving untrusted pages to the open internet would need a way to take
  down what is abused. The ADR for the view address records this as a
  decision, so it is not reopened as a small feature.
- **A runtime inside the page.** No calls to a team model, no stored state,
  no "who is viewing", no comments. Each is a capability granted through the
  gateway or the API, with its own budget and audit questions; they come
  after the static version is in use.
- **JSX compiled for the author.** An agent that wants React writes an HTML
  page that loads it from an allowed CDN.
- **Editing in the browser.** Changes are made by an agent in a session, so
  every version has a session behind it. People view, share, restore and
  delete.
- **Storing the session.** Only what the agent deliberately publishes through
  the tool reaches the server; the conversation around it stays where it is
  today. This is the one exception to the relay's "storing session content"
  ([relay.md](relay.md), "Non-goals of this plan"), changed with the first
  code.
- **A web host.** Limits are a page's, not a site's, and nothing runs on the
  server.
- **Notifications.** A page shared with someone appears in their list; no
  email, push or badge in this plan.

## Terms

- **Page**: a titled, versioned thing one team owns, of one kind: `html` (an
  entry `index.html` and the files it loads), `markdown` (one `index.md`) or
  `svg` (one `index.svg`). The console calls it a page in both languages
  ("Pages"; in Chinese the everyday word for a web page), and so does the
  code. "Artifact" already names plugin archives here
  (`server/internal/artifactstore`, `/api/teams/{teamId}/artifacts`, which
  installed plugins call), so pages never use it.
- **Version**: an immutable set of files, numbered from 1, with its author,
  the session it came from and a one-line note.
- **Sharing**: one of three, set on the page by a person:
  - `private`, **the default** for every page however it is made: its owner
    alone;
  - `members`: its owner and the members of its team the owner chose;
  - `team`: every member of its team.
- **Reader**: anyone the sharing admits who is a member of the team now. An
  admin is a reader only where the sharing admits them like anyone else.
- **Owner**: renames, shares, restores and deletes their page.
- **Admin of the team**: governs every page of the team without reading it:
  lists them all (title, owner, sharing, size, newest version's time),
  **narrows** a page's sharing (to `private`, or removes members), and
  deletes it. An admin never widens a page's sharing, so they cannot share a
  page with themselves or the team to read it; widening is the owner's
  alone.
- **View address**: an absolute URL on `CONTENT_URL` that serves one
  version's files to one reader for an hour.

## Architecture

```
 DSH session                server (one binary)                    browser / app
 ───────────                ───────────────────                    ─────────────
 agent ──teamwork_page──▶ plugin ──POST /api/teams/{t}/pages──▶ internal/pages ──▶ DB rows
                             (plugin, computer      │                    └──▶ object store
                              or host token)        │                         teams/{t}/pages/{digest}
                             ◀── { id, version } ───┘
 tool result ─────── relay (E2E, unchanged) ───────────────────────▶ relay-client: `page` item
                                                                          │ card
 console / app ──POST …/pages/{id}/versions/{n}/view (cookie|Bearer)──▶ server
                ◀── https://<CONTENT_URL>/p/{token}/ ──────────────────────┘
 <iframe> / WebView ──GET <CONTENT_URL>/p/{token}/{path}──▶ re-check reader, stream file
                                                            with the sandbox headers
```

- **`server/internal/pages`** (new package) holds every rule: who may read,
  add a version, share, restore and delete; limits; the view token; serving.
  `internal/httpapi` maps routes to it, as it does for `internal/team`.
- **The object store** is the existing `artifactstore.Store`, under a kind of
  its own (`pages`), beside plugin archives (ADR 0042's key layout).
- **The relay is unchanged.** The tool's result travels in the session like
  any tool result; the bytes never do.
- **The content origin** is a second listener name on the same process: the
  router sends a request for `CONTENT_URL`'s host to the page handler alone.

## Data model

One migration in `server/internal/db` (three dialects), ent schemas in
`schema/pages.go`. Ids are nanoids set by the application; times are
`datetime(6)` on MySQL; tables are `utf8mb4_bin`; a column's size is four
bytes per character the API allows.

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `pages` | `id`; `team_id`; `owner_id` (a user); `kind` (`html`, `markdown`, `svg`); `title` (≤ 120 chars); `sharing` (`private`, `members`, `team`); `current_version` (int); `created_at`; `updated_at` (the newest version's time) | `(team_id, owner_id, updated_at)`; `(team_id, sharing, updated_at)` |
| `page_versions` | `id`; `page_id`; `number`; `author_id`; `host_id` (nullable: a Team DSH); `computer` (≤ 64, the plugin's own name for its DSH); `session_id` (≤ 128, opaque); `note` (≤ 200 chars); `size` (bytes, all files); `created_at` | unique `(page_id, number)` |
| `page_files` | `id`; `version_id`; `team_id`; `path` (≤ 255); `content_type` (≤ 100); `size`; `digest` (32 chars, below) | unique `(version_id, path)`; `(team_id, digest)` for collection |
| `page_members` | `page_id`; `user_id`; `added_by`; `created_at` | unique `(page_id, user_id)`; `(user_id, page_id)` for **Shared with me** |

- **The owner never changes.** A Team DSH's page is owned by the session's
  starter (below); `host_id` on its versions says where it was made.
- **`current_version` moves by a conditional update**
  (`UPDATE pages SET current_version = n+1 WHERE id = ? AND current_version = n`),
  never a lock: zero rows is `409 page_stale`.
- **`page_members` rows exist only while sharing is `members`.** Changing to
  `private` or `team` deletes them in the same transaction; changing the list
  replaces it whole.
- **Deleting a page** deletes its members, files, versions and row in one
  transaction, then its objects (below).
- **A member who leaves the team** keeps their `page_members` rows until the
  list next changes, and reads nothing meanwhile, because every read checks
  membership. Their own pages stay the team's, owned by an id that is no
  longer a member; nobody reads a private one again, and the team's admins
  can narrow or delete them.

## Object storage

- **Key**: `teams/{teamId}/pages/{digest}`, through `PutObject`, `OpenObject`
  and `DeleteObject` (ADR 0042). `digest` is the file's SHA-256, its first 24
  bytes in unpadded base64url: 32 characters, which `artifactstore`'s id rule
  admits, and 192 bits, which no two files collide on.
- **Content-addressed within a team**: a version that repeats a file stores
  nothing new. Two teams never share an object, so deleting in one cannot
  touch the other, and a team's objects stay under its prefix.
- **Write order** (as ADR 0033): hash and size each file while reading the
  upload into a bounded temporary file; `PutObject` each digest the team does
  not hold yet; then commit the rows. If the commit fails, delete the objects
  this request wrote and no row names; an ambiguous database failure leaves
  them, logged.
- **Collection**: after a page is deleted, each of its digests that no
  `page_files` row of the team still names is deleted. A failed delete is
  logged and leaves bytes behind; nothing else lists the store.
- **Limits**: 16 MiB a version, 255 files, 5 MiB a file; paths are relative,
  `/`-separated, without `.`/`..` segments, backslashes or control
  characters, at most 255 bytes.
- **A team holds at most 2 GiB of pages**, counted as the sizes of its
  distinct digests, on every edition alike. An upload that would pass it is
  `413 page_team_full` before any object is written. The sum is read before
  the write rather than held under a lock, so two uploads at once can pass it
  by at most one version.
- **Versions are kept for as long as their page.** There is no deleting one
  version and no expiry; deleting the page deletes them all.

## API

All in `api/openapi.yaml`; failures are `wire.Error` codes worded in
`teamErrors.*`. A page the caller may not read is `404 page_not_found`, never
a 403, so its existence is not told.

| Route | Caller | Does |
| --- | --- | --- |
| `POST /api/teams/{teamId}/pages` | plugin, computer or host token | Creates a page at version 1, `private` |
| `POST /api/teams/{teamId}/pages/{id}/versions` | the same | Adds a version on top of `baseVersion`, if the author may read the page |
| `GET /api/teams/{teamId}/pages?list=mine\|shared\|all&before=` | session or Bearer | The reader's own, those shared with them, or (admins) every page of the team without its content; 50 at a time, newest version first |
| `GET /api/teams/{teamId}/pages/{id}` | session or Bearer | For a reader: the page, its versions (author, time, note, where made), and for its owner its members. For an admin who is not a reader: the same fields as the list, and its members |
| `PATCH /api/teams/{teamId}/pages/{id}` | owner | `{ title }` |
| `PUT /api/teams/{teamId}/pages/{id}/sharing` | owner, or an admin narrowing | `{ mode, members? }`, the whole list at once |
| `POST /api/teams/{teamId}/pages/{id}/versions/{n}/restore` | owner | A new version copying version `n`'s files |
| `DELETE /api/teams/{teamId}/pages/{id}` | owner or admin | Deletes the page and collects its objects |
| `POST /api/teams/{teamId}/pages/{id}/versions/{n}/view` | session, Bearer, or plugin tokens | `{ url, files, expiresAt }`: a view address and the version's file list |
| `GET <CONTENT_URL>/p/{token}/{path}` | whoever holds the address | One file, re-checked and sandboxed |

- **Upload body**: `multipart/form-data`, at most 16 MiB plus headers. Part
  `meta` (JSON): `title`, `kind`, `note`, `sessionId`, `computer`, and on a
  version `baseVersion`; on a host token, also `starter` (a user id). Every
  other part is a file, its form name the path. The server checks the kind's
  entry exists (`index.html`, `index.md` or `index.svg`), the limits, and
  each content type against its extension (a fixed table; unknown is
  refused, `page_invalid`).
- **Who uploads**: a plugin token's member; a computer token's member (the
  hosted edition's cloud sessions); a host token's team, naming the starter,
  who must be a member of that team now. `requirePlugin`
  (`internal/httpapi/identity.go`) gains the two upload routes and `view`,
  and its comment its list.
- **Errors**: `page_not_found` 404, `page_stale` 409 (with `currentVersion`),
  `page_too_large` 413, `page_team_full` 413, `page_invalid` 400, `page_member_not_in_team` 400,
  `page_not_owner` 403 (a reader or admin asking for the owner's change),
  `page_sharing_widened` 403 (an admin's change that would admit anyone not
  already admitted). A page an admin cannot read still answers its view
  address with 404.
- **The lists**: **Mine** is `owner_id = caller`; **Shared with me** is
  `owner_id ≠ caller AND (sharing = team OR (sharing = members AND a
  page_members row names the caller))`; **All**, for an admin alone, is every
  page of the team, so one can be narrowed or deleted without being read. Each is
  within the team and paged by `(updated_at, id)`. Each row: id, title, kind, sharing, member count (for
  the owner), owner, current version, its author and time, and how the reader
  got it (`you` or `team`).

## The view address

- **The token** is sealed by `auth.Sealer` under a new purpose,
  `dsh-teamwork.page-view`, so it never opens as a session or a Bearer and
  none of those opens as it. Claims: viewer, team, page, version; an hour.
  The plugin's `open` gets one too, for its member or the starter.
- **`/p/{token}/` re-checks on every request**, not only when minted: the
  token opens; the viewer is a member of the team now; the page exists and
  admits them; the version exists. Removing a member from the list or the
  team, making the page private or deleting it stops the next file, even in
  a page already open. One indexed query a file.
- **Paths**: `/p/{token}/` serves the kind's entry (Markdown rendered, below);
  `/p/{token}/{path}` serves that file of the version; anything else is 404.
  Relative links in the page resolve under the token, so supporting files
  load with no cookie.
- **Markdown** is rendered on each request with goldmark and its GitHub
  extensions, raw HTML escaped, into a fixed HTML document with a small
  built-in stylesheet. One dependency, no stored derived file.
- **Headers on every response under `/p/`**:
  - `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms
    allow-modals; default-src 'none'; script-src 'self' 'unsafe-inline'
    'unsafe-eval' <cdns>; style-src 'self' 'unsafe-inline' <cdns>; img-src
    'self' data: blob: <cdns>; font-src 'self' data: <cdns>; connect-src
    <cdns>; media-src 'self' data: blob:; frame-src 'none'; form-action 'none';
    base-uri 'none'; frame-ancestors <APP_URL>`, where `<cdns>` is
    `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`;
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
    `Cross-Origin-Resource-Policy: same-site`, `X-Robots-Tag: noindex`;
  - `Cache-Control: private, no-cache` and an `ETag` of the digest, so a
    browser revalidates (and is re-checked) every time and gets a 304;
  - no `Set-Cookie`, and any cookie sent is ignored.
- **Where `/p/` is served: `CONTENT_URL`**, else `APP_URL`'s origin. The
  hosted service sets `https://dshteam.work`, a domain registered for nothing
  else, so a page is another site as well as an opaque origin: the console's
  host-only cookies never go there, a page cannot pass for the console in the
  address bar, and a browser or WebView that ignored the sandbox still could
  not reach the console. A self-hosted server needs no second domain and
  relies on the sandbox alone. When the two differ, `CONTENT_URL`'s host
  answers `/p/` and a `robots.txt` that refuses every crawler, and 404 to
  everything else; `APP_URL`'s host answers `/p/` with 404. The server
  refuses to start when `CONTENT_URL` is on `APP_URL`'s registrable domain
  (a subdomain would share its cookies' site) or is not https off loopback.

## The plugin tool

In the plugin repository, beside the other `teamwork_*` tools
(`src/assistant-tools.ts`, with the HTTP calls in `src/client.ts`):

- **`teamwork_page`**, arguments (zod, strict):
  - `action`: `create`, `update` or `open`;
  - `create`: `title`, `kind`, `note`, and either `content` (one file's
    text, for `markdown` and `svg`, and an `index.html` alone) or `directory`
    (a folder in the session's folder holding the entry and its files);
  - `update`: `pageId`, `baseVersion`, `note`, and `content` or `directory`;
  - `open`: `pageId`, and `directory` to write the current version into.
- **Which team**: the team of the session's active preset, as the other
  `teamwork_*` tools decide it; with no team preset, the member's only team;
  otherwise the tool refuses and lists the member's teams for the agent to
  name one (`teamId`). `update` and `open` use the page's own team.
- **Reading files**: only inside the session's folder, after resolving
  symbolic links; hidden files and anything over the limits refused before
  any upload, with the rule named so the agent can fix it.
- **The result** is one line for the agent and a JSON object for clients:
  `{"teamworkPage":{"teamId","pageId","version","title","kind"}}`. It holds
  no content: the relay's `fitFrame` would cut it, and the card needs only
  the id.
- **Conflicts**: on `page_stale` the tool answers the agent with the current
  version and tells it to `open` and reapply. Two agents never overwrite each
  other silently.
- **Never sharing**: the tool has no argument that changes sharing, so text
  an agent read cannot get a page shared.
- **On a Team DSH** the plugin holds a host token; it names the starter from
  its roster for the session ([shared-dsh.md](shared-dsh.md), "Sessions
  belong to their starter"), and a session with no starter cannot publish.

## The clients

- **`packages/relay-client`** (`dsh.ts`, `conversation.ts`): a `tool/result`
  of `teamwork_page` that is not an error, carrying `teamworkPage`, becomes a
  `page` conversation item `{ kind: 'page', id, teamId, pageId, version,
  title, pageKind }` after its tool item, live and from history. Every client
  that follows a session (the console's My DSH and Team DSH, the hosted
  edition's cloud sessions and phone app) gets it with no change of its own.
- **The card** (`apps/web/src/pages/team/dsh-session.tsx`): the kind's icon,
  the title, "version N"; clicking it opens the viewer. On a wide screen
  (`xl`) the viewer is a column beside the conversation; narrower, it covers
  the conversation with a way back. A page of another team, or one the
  member can no longer read, says so instead of opening.
- **The viewer** (`apps/web/src/components/page-viewer.tsx`, shared by the
  column and the Pages page): mints a view address, frames it
  (`<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals">`,
  matching the header), renews it before its hour runs out by reloading, and
  shows the title, the sharing, the version picker, **Share** (the owner; an admin sees **Restrict** instead, offering only
  narrower choices),
  **Open in a new tab** and **Copy link** (to the console's page for it,
  never the view address).
- **Pages in the sidebar**: `GROUPS`' `work` group in
  `apps/web/src/components/team/console-shell.tsx`, after Team DSH, for
  everyone in every team, always listed; `/teams/{teamId}/pages` (**Mine**),
  `?list=shared` (**Shared with me**), `?list=all` (**All**, a third tab an
  admin alone sees: rows they cannot read show no viewer, only **Restrict**
  and **Delete**), `/teams/{teamId}/pages/{id}` (one page), in `apps/web/src/pages/team/team-pages.tsx`, laid out as My DSH: the
  list with a title filter, and the viewer with the versions (author, time,
  note, where made, with a link to the session where the reader can open
  it), **Restore** for the owner and **Delete** for the owner and admins. Empty, it says how to make
  one.
- **Share** is one dialog: **Only me**, **Specific members** (a picker over
  this team's members by name or email, the chosen listed with a way to
  remove each) and **Everyone in the team**; readers see who can read.
- **Words**: `team.nav.pages` and `pages.*` in both locales' messages; the
  published `/docs` site gains a members' page on pages in both languages.

## Security

| Threat | Answer |
| --- | --- |
| A page's script acts as the viewer (reads the session, calls the API) | Opaque origin by CSP sandbox; on the hosted service another site too; no credential in the address but its own token |
| A page passes for the console (phishing) | Another domain on the hosted service; `noindex`; only team members ever get an address |
| An address leaks (a screenshot, a log) | One reader, one version, an hour, and useless to anyone the next re-check refuses |
| Revocation lags | Every file request re-checks |
| An agent is told to share | The tool cannot share |
| A teammate's upload overwrites another's | `baseVersion` and the conditional update |
| Disk filled | Per-version limits and 2 GiB a team |
| A page leaks data | It can only read itself; `allow-popups` lets it open a URL carrying what it shows, which its readers could already copy |
| Content sniffing, SVG script | `nosniff`; SVG is served under the same sandbox as HTML |
| Another site frames a page | `frame-ancestors` is `APP_URL` alone |

## Editions

| Piece | Where | Edition |
| --- | --- | --- |
| Tables, rules, routes, `/p/`, `CONTENT_URL` | `server/internal/pages`, `internal/db`, `internal/httpapi`, `internal/web` (the host router), `api/openapi.yaml` | Open |
| `teamwork_page` | the plugin repository | Open |
| The `page` item | `packages/relay-client` | Open |
| The card, the viewer, Pages, Share | `apps/web` | Open |
| The phone's viewer and Share, cloud sessions, `dshteam.work` | where `premium/` exists | Closed |

## Configuration and operations

- **`CONTENT_URL`** (new, optional): the origin `/p/` is served from. Added to
  `docs/ops/self-hosting.md` and `CHANGELOG.md` in the commit that adds it.
  A self-hoster who sets it points a second domain at the same server.
- **Backups**: pages are rows and objects, like plugin archives; the existing
  advice (both stores together) covers them.
- **Management processes** open no store and serve no page.
- **Expensive to change**: the view address, its headers and the content
  domain (the security boundary; `dshteam.work` stays registered while view
  addresses name it); the tool's arguments and the upload's shape (installed
  plugins); the object keys (a bucket migration, ADR 0042); uploading at
  creation (clients assume a page opens anywhere).
- **ADRs**, written with the first code: pages are uploaded when made, the
  exception to "storing session content"; the view address, its content
  origin and that no page leaves its team.

## Order of work, and what gates what

Each step is one pull request per repository it touches, through the gate,
with its `CHANGELOG.md` entry; the plugin is released before the console
depends on its result. Sizes are rough: S a day or two, M a week, L two.

### Step 0 — two spikes, thrown away (S each; gate everything)

1. **Isolation.** A scratch Go handler serving a fixture page with the
   headers above, at `/p/{token}/`, both on `APP_URL`'s origin and on a
   second site, framed by a page on `APP_URL`, in Chrome, Safari, Firefox,
   Android's WebView and iOS's WKWebView. Pass: `document.cookie`,
   `localStorage`, `indexedDB`, `navigator.serviceWorker.register` and a
   `fetch('/api/me')` each fail or see nothing; a relative image, a jsdelivr
   script, an inline script and `window.open` each work; a 304 revalidation
   happens on reload. **If a WebView will not keep the opaque origin on the
   same site**, the self-hosted phone viewer opens pages in the system
   browser instead; the rest stands.
2. **The tool's result on the wire.** A scratch plugin tool returning the
   result shape above, in a real DSH: it reaches the console through the
   relay, live and from `session/page`, readable as `tool/result` with the
   tool's name and its JSON intact; and the tool's execution context gives
   the session id and the session's folder. **If it does not**, the card is
   found by matching the call's arguments instead, and step 3's item changes
   shape.

### Step 1 — the server's private slice (L; platform)

- Schema, ent generation and the migration (`pages`, `page_versions`,
  `page_files`, `page_members`).
- `internal/pages`: create, add a version, the conditional update, limits,
  digests and object writes, the team's 2 GiB, the view token purpose, `/p/` serving with the
  headers, Markdown rendering, `CONTENT_URL` (config, host routing, start-up
  checks, `robots.txt`).
- Routes: the two uploads (plugin, computer and host tokens), `GET …/pages`
  (`mine` only), `GET …/pages/{id}`, `…/view`; `requirePlugin` extended;
  `api/openapi.yaml` and `api.gen.ts`.
- Docs in the same pull request: the two ADRs; `relay.md`'s non-goal;
  `shared-dsh.md`'s trust statement ("never read", but for what an agent
  publishes); `self-hosting.md`; this plan's status line.
- Done when the Go suites below pass on all three dialects.

### Step 2 — the plugin's tool (M; plugin repository)

- `teamwork_page` `create` and `update` (`open` waits for step 4), team
  resolution, file reading inside the session's folder, the upload, the
  result shape, `page_stale` handling.
- Tests in the plugin; `server/e2e` makes a page from a real DSH session and
  adds a version.
- Released, and the team's plugin pin raised where needed.

### Step 3 — the console's private slice (M; platform)

- The `page` item in `packages/relay-client`, the card, the viewer column,
  **Pages** with **Mine** and one page's view (versions shown, no actions
  yet), the words in both locales, the `/docs` page.
- Done when a member makes a page on My DSH and opens it from the card and
  from Pages, and the browser test of the boundary passes in CI.

### Step 4 — sharing (L; platform and plugin)

- Server: `PUT …/sharing`, `page_members`, **Shared with me**, **All** for
  admins, readers adding
  versions, `PATCH`, restore, delete and collection, the owner's and admins'
  rights (an admin narrows, never widens), the
  host token's starter path.
- Plugin: `open` (a view address, then each file into `directory`).
- Console: Share, **Shared with me**, **All**, version picker, Restore, Delete.
- Done when the Goal's four steps pass by hand with two accounts on a
  self-hosted server, and on the hosted one with `dshteam.work`.

### Step 5 — the hosted edition (M; premium, its own plan)

- `CONTENT_URL=https://dshteam.work` on the member service, its domain and
  certificate on Railway, `deployment.md`.
- The phone app's viewer and Share; cloud sessions checked end to end.
- The privacy policy: pages are stored on the service, and who can read them.

```
step 0 ─┬─▶ step 1 ─▶ step 2 ─▶ step 3 ─▶ step 4 ─▶ step 5
        └── a failed spike changes step 3 (item) or step 5 (phone) before they start
```

## Open questions

- **Read-only readers.** Every reader may add a version here; a per-member
  "can view" against "can edit" comes if a team asks.

## How done is verified

- **Go tests on every dialect** (`internal/pages`, `internal/httpapi`):
  - neither a teammate nor an admin can read a private page (view address
    and content 404); an admin lists it under **All**, which a member cannot
    list, and can make it narrower or delete it;
  - an admin's change that would admit anyone new (to `team`, to `members`
    from `private`, or adding a member) is `page_sharing_widened`, and leaves
    the page as it was; under `members` a
    chosen member reads and adds a version and an unchosen one gets 404;
    under `team` everyone does;
  - a member who left the team reads nothing; a host token's starter who is
    not a member is refused;
  - changing to `team` and back starts from an empty list; only the owner
    widens, renames and restores, and the owner or an admin deletes;
  - a stale `baseVersion` is a 409 and leaves the page as it was; two
    concurrent versions on the same base produce exactly one;
  - limits, the team's 2 GiB, paths and content types are refused before any
    object is written; a refused commit leaves no new object;
  - deleting a page removes the objects no other page of the team names, and
    keeps those another page does;
  - every response is valid against `api/openapi.yaml`.
- **The boundary** (`internal/pages`): a view address opens only its version,
  not after its hour, not for another team, not once its reader is removed;
  every `/p/` response carries the headers above and sets no cookie; with
  `CONTENT_URL` set, `/p/` on `APP_URL` is 404, the content host serves
  nothing else, and a `CONTENT_URL` on `APP_URL`'s registrable domain stops
  the server at start.
- **End to end** (`server/e2e`): a real DSH session makes a page, adds a
  version, opens it, and reads both versions through view addresses.
- **In a browser, in CI**: step 0's isolation checks against the real
  server, so a header change that reopens the origin fails the gate.
- **By hand before each release**: the Goal's four steps with two accounts,
  on the web, and on the phone once step 5 lands.
