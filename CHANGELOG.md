# Changelog

Every key change to DSH Teamwork, newest first, by date. An agent starting a
task reads the top of this file to learn what moved recently; git holds the
detail. What counts as key, the entry format and how old entries are compacted
are in `CLAUDE.md`, "The changelog".

## 2026-11-19 — An unknown /relay address answers JSON

- **What:** A `/relay/` path no route claims answers `404 {"error":"not_found"}`, as an unknown `/api/` path does, instead of the console's page with 200. With Team DSH offline that includes `GET /relay/shared`, which the phone app read as JSON and failed on.
- **Why:** A client reading the relay's JSON got HTML and a parse error rather than an error it could handle.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/httpapi/server.go`, `TestTeamDSHOffline` in `server/relay/relay_test.go`.

## 2026-11-19 — An admin deletes a team; a member removes an offline computer

- **What:** `DELETE /api/teams/{teamId}` lets a team's admin delete it with everyone in it, the team's name typed back as `confirm`; the console offers it at the foot of Members. `DELETE /relay/hosts/{id}` lets a member forget one of their own computers, once it is offline, with its pairing codes and every pairing to it (`host_online` while it is connected); My DSH offers it on an offline computer. `confirmation_mismatch` is now worded for either confirmation.
- **Why:** A team could end only with its admin's account, and a computer's record, a stale one left by signing in again included, could not be removed at all.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** ADR 0056, `docs/tech/relay.md` ("My DSH in the web console"), `server/internal/team/account.go`, `server/relay/relay.go`.

## 2026-11-19 — A session shows a turn that failed

- **What:** `@dsh-teamwork/relay-client` reads DSH's `turn/end` with an error into a `failed` conversation item (`message`, and `noModel` when the session had no model to call), and the console and the phone show it in the conversation, a missing model with where to choose or add one. A prompt refused as `model_unavailable` (no model, no key on that computer, or a removed team model) now says so and where to choose another.
- **Why:** A turn that failed, most often a session with no model, ended with nothing on screen, so a message seemed to go unanswered.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `packages/relay-client/src/dsh.ts`, `apps/web/src/pages/team/dsh-session.tsx`.

## 2026-11-19 — The model catalogue lookup is a package an edition can call

- **What:** The Models.dev and OpenRouter lookup and the USD/CNY rate behind `POST /api/teams/{teamId}/model-metadata/lookup` move from `internal/httpapi` to the exported `server/modelmeta` (`Search`, `ExchangeRate`), which adds `Endpoints`: the upstreams OpenRouter routes a model to, each with its own price. The route and its answers are unchanged.
- **Why:** The hosted edition's operator console fills its catalogue from the same sources, and should not keep a second parser of them.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/modelmeta`, `docs/tech/architecture.md` ("Live model form suggestions").

## 2026-11-19 — Pages sit under Team resources, called "shared pages" in Chinese

- **What:** The console's Pages entry moves from after My DSH to right under Team resources in Workspace, and its Chinese name becomes "shared pages" (the entry and the page's heading); English keeps "Pages".
- **Why:** Pages are the team's own assets, beside its resources, and a member who reads teammates' pages without running a DSH finds them near the top; "page" alone said nothing in a console of pages.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/components/team/console-shell.tsx`, `docs/tech/pages.md`.

## 2026-11-19 — A funded route states its own bounds

- **What:** `edition.FundingQuote` adds `MaxInput`, `MaxOutput` and `Body`: a funded call is bounded by its route's stated limits (`usage.RouteBounds`, the DeepSeek adapter's checks with those limits) instead of only direct DeepSeek, and the route adds upstream fields no caller may send. `FundingSettlement` adds `UpstreamCost`, the upstream's own `usage.cost`; the observer also reads OpenRouter's `cache_write_tokens`. `edition.Host` adds `Seal` and `Unseal` for an extension's own secrets under `PROVIDER_KEYS_SECRET`. The gateway's forwarded fields are `usage.ChatFields`.
- **Why:** An edition could fund DeepSeek and nothing else; hosted models through OpenRouter need their own bounds, a routing object and the price OpenRouter charged.
- **Breaking:** An edition's quote must state `MaxInput` and `MaxOutput`, or the call is refused.
- **Upgrade:** Nothing for a community instance.
- **Refs:** `docs/adr/0054-a-funded-route-states-its-bounds.md`, `docs/tech/usage-budgets.md`, `server/edition/funding.go`.

## 2026-11-19 — Pages are shared with chosen members or the team

- **What:** A page's owner shares it with **Only me**, **Specific members** of the team or **Everyone in the team** (`PUT /api/teams/{teamId}/pages/{id}/sharing`), renames it (`PATCH …/{id}`), restores an old version as a new one (`POST …/versions/{n}/restore`) and deletes it (`DELETE …/{id}`, collecting objects no other page names). Readers find pages under **Shared with me** (`?list=shared`) and add versions. The team's admin lists every page under **All** (`?list=all`), narrows its sharing (`403 page_sharing_widened` for anything that admits someone new) and deletes it, but reads its content only where it is shared with them. `GET …/pages/{id}` adds `access`, `members` and `via`. A Team DSH opens a page for the session's starter (`…/view?starter=`). The plugin's `teamwork_page` gains `open`.
- **Why:** Step 4 of `docs/tech/pages.md`: a team's pages are shared within it and never outside it.
- **Breaking:** None.
- **Upgrade:** Nothing; `page_members` came with the first migration.
- **Refs:** `server/internal/pages/sharing.go`, `apps/web/src/components/page-share.tsx`, `docs/tech/pages.md`.

## 2026-11-19 — The console shows pages agents publish

- **What:** A conversation on My DSH shows a card for each page the agent published with the plugin's `teamwork_page` tool; the card opens the page in a panel beside the conversation. **Pages** under Workspace lists the reader's own pages of the team, newest first, and shows one with its versions, each served sandboxed from its view address. `@dsh-teamwork/relay-client` reads the tool's `meta.teamworkPage` into a `page` conversation item and row.
- **Why:** Step 3 of `docs/tech/pages.md`.
- **Breaking:** A client that switches over `ConversationItem` or `Row` kinds meets a new `page` kind (the hosted edition's cloud sessions and phone app draw it in their own change).
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/components/page-viewer.tsx`, `apps/web/src/pages/team/team-pages.tsx`, `packages/relay-client/src/dsh.ts`.

## 2026-11-19 — The server keeps pages agents publish, private to their maker

- **What:** A new `internal/pages` and four tables (`pages`, `page_versions`, `page_files`, `page_members`): a DSH plugin, computer or host token publishes a page (an HTML page and its files, a Markdown document or an SVG) with `POST /api/teams/{teamId}/pages` and adds versions on top of the current one (`…/{id}/versions`, `409 page_stale` otherwise); a member lists their own (`GET …/pages`), reads one (`GET …/pages/{id}`) and gets a one-hour view address (`POST …/versions/{n}/view`). Files are stored once per team by digest under `teams/{teamId}/pages/` in the existing object store, 16 MiB a version and 2 GiB a team. `/p/{token}/` serves them under a CSP sandbox without `allow-same-origin`, re-checking the reader on every request, from `CONTENT_URL` when set. Pages are private; sharing, the console and the plugin's tool follow.
- **Why:** Step 1 of `docs/tech/pages.md`: what agents make in sessions becomes the team's, viewable on any device without the page acting as its viewer.
- **Breaking:** None. The relay's "no session content on the server" now excepts published pages (ADR 0052).
- **Upgrade:** The migration applies at start. Optional `CONTENT_URL`: an origin on a domain of its own, pointed at the same server; the server refuses one on `APP_URL`'s registrable domain.
- **Refs:** ADR 0052, ADR 0053, `docs/tech/pages.md`, `server/internal/pages`.

## 2026-11-19 — The phone's pairings say when each computer was last seen

- **What:** `GET /relay/pairings` (and every pairing the relay returns) adds `hostLastSeenAt`, the host's `last_seen_at`, null for a shared DSH that never connected; `@dsh-teamwork/relay-client`'s `Computer` adds `lastSeenAt`.
- **Why:** The phone app says how long an offline computer has been away, as the web console does; it knew only that it was offline.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/relay/pairing.go`, `packages/relay-client/src/live.ts`, `docs/tech/relay.md`.

## 2026-11-19 — My DSH follows each computer's state

- **What:** My DSH's list says whether each computer is online, as a green or grey dot and word (the web app gains the `--success` token for it), and whether this browser is paired with it, and is read again every ten seconds. The open computer's header puts its name, system and DSH version on the left and its state, with when it was last seen, in a pill on the right. The open computer's page shows one state at a time: offline, not paired (pairing), connecting, unreachable (with a retry), its PIN, and only then sessions and the composer; a session's address opened while the computer is not ready shows that state instead.
- **Why:** An offline computer this browser had paired with opened straight to the composer, with only a red "offline" line above it, and the list did not say it was offline.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/my-dsh.tsx`, `docs/tech/relay.md`.

## 2026-11-19 — The DSH plugin's panel shows preset avatars

- **What:** The plugin's Teamwork panel draws each team preset's avatar, the assistant's included, in place of its generic icon. The plugin cannot import `@dsh-teamwork/shared`, so it keeps a byte-for-byte copy of `avatars.ts` (`src/web/avatars.ts` in its repository); the plugin end-to-end suite here fails when the two differ (`server/e2e/avatars_test.go`), so a change to the library is copied there in the same working session.
- **Why:** The console and the phone showed a preset's avatar; the panel in DSH, where most sessions start, did not.
- **Breaking:** None.
- **Upgrade:** Release the plugin.
- **Refs:** `server/e2e/avatars_test.go`, `docs/design.md` ("Preset avatars").

## 2026-11-19 — Provider marks in their makers' colours

- **What:** Each provider's mark is drawn in its maker's own colours and gradients (LobeHub's colour icons; OpenAI, Anthropic, xAI, Ollama and OpenRouter stay black) on a new `--mark-plate` tile, light in both themes, in the console, on the home page's diagram and in the phone app. `PROVIDER_MARKS` now holds shapes and gradients instead of single-colour paths, and the web app's `MarkSvg` draws one.
- **Why:** Single-colour marks were hard to tell apart; a maker is recognised by its colours.
- **Breaking:** `PROVIDER_MARKS` entries change shape (`MarkArt`), so every client drawing one changes with it.
- **Upgrade:** Nothing; the phone app's colours ship with its next build.
- **Refs:** `packages/shared/src/providers.ts`, `apps/web/src/components/provider-mark.tsx`, `docs/design.md` ("Icons").

## 2026-11-18 — A computer's sessions run over any link; the console's session parts take their client

- **What:** `@dsh-teamwork/relay-client` splits a computer's sessions (list, follow, start, prompt, answer, configure, upload) from the relay into `dsh-sessions.ts`: `createDshSessions` runs them over any `DshLink` (a unary call, a stream, a close), and the live relay is one such link. `bridgeValue` reads a plugin bridge's `{ status, body }` answer. The web console's session parts (`dsh-session.tsx`) speak to `SessionClientContext`'s client when a page provides one, and to this browser's relay otherwise. `relayed.ts` (`receiveRelayed`, `relayedPending`, `answerRelayed`), which only the hosted edition's cloud sessions used, is removed.
- **Why:** The hosted edition's Cloud DSH, a member's own computer its server reaches without the relay, uses the same screens as My DSH instead of a thinner copy.
- **Breaking:** An edition importing `relayed.ts` moves to `createDshSessions` over its own link.
- **Upgrade:** Nothing.
- **Refs:** `packages/relay-client/src/dsh-sessions.ts`, `apps/web/src/pages/team/dsh-session.tsx`, `docs/tech/relay.md`.

## 2026-11-18 — A computer's operating system, and My DSH's devices page

- **What:** The plugin's relay hello adds `os` (`macos`, `windows` or `linux`; any other value is refused 4400, none is allowed), stored in the new nullable `relay_hosts.os` and refreshed on every connection. `GET /relay/pairings` adds `hostOs` and `GET /relay/hosts` adds `os`; `@dsh-teamwork/relay-client`'s `Computer` adds `os`. My DSH shows each computer's operating system and, beside it, the number of devices paired with it, which opens a devices page of its own (`/teams/{teamId}/my-dsh/{hostId}/devices`) where each is removed; the computer's page no longer lists them.
- **Why:** A member with several computers tells them apart by their system, and the devices were folded away under a computer's sessions, where nobody looked for them.
- **Breaking:** None: a plugin that sends no `os` connects as before and its computer shows none.
- **Upgrade:** The migration `relay_host_os` runs at start. A computer shows its system once a plugin that reports it (the release after 0.11.3) reconnects.
- **Refs:** `server/relay/protocol.go`, `apps/web/src/pages/team/my-dsh.tsx`, `docs/tech/relay.md`.

## 2026-11-18 — Presets have avatars

- **What:** A preset carries `avatar`, the id of one of 18 vector avatars in `@dsh-teamwork/shared` (`avatars.ts`), which the web console and the phone app both draw: an abstract emblem of a role, a few flat shapes in paper and one accent on the role's own plate (team assistant, finance, administration, HR, marketing, sales, engineering, product, legal, design, support, operations, project management, training, development, research, data analysis, writing). The preset editor chooses one (a blank preset starts with a random one, a template with its role's, a new team assistant with `assistant`); the presets page, Team resources, review diffs and the DSH session bar show it. A preset with none, or one a client does not know, shows one picked from its name. The server checks only the id's shape (`^[a-z][a-z0-9-]{0,39}$`); the plugin passes it to the relay's session configuration.
- **Why:** Presets were text-only, hard to tell apart in a list or on a phone, and a team hands work to a preset as to an expert.
- **Breaking:** None; the field is optional and readers ignore it.
- **Upgrade:** Nothing. Release the plugin for the avatar to reach the phone and My DSH.
- **Refs:** `packages/shared/src/avatars.ts`, `apps/web/src/components/preset-avatar.tsx`, `docs/design.md` ("Preset avatars").
## 2026-11-18 — The listed providers are named as Models.dev names them

- **What:** The console's provider list (`PROVIDER_CATALOG`) uses Models.dev's provider ids as each provider's id and default name in the team (`deepseek`, `openai`, `alibaba-cn`, `moonshotai-cn`, `zhipuai`, `volcengine`, `minimax-cn`, `siliconflow-cn`, `openrouter`), at the address Models.dev states (DeepSeek moves to `https://api.deepseek.com`); OpenAI, which Models.dev gives no address, and MiniMax, whose address there is its Anthropic API, keep their OpenAI-compatible ones. `modelsDevId` is gone: a provider's name is the namespace its models' limits and prices are read under, and a renamed second account is matched by address. The display names' message keys follow the ids.
- **Why:** One id for a provider in the team and in its public reference, so a model maps straight to its metadata and price.
- **Breaking:** A provider connected earlier under `qwen`, `moonshot`, `zhipu`, `doubao`, `minimax` or `siliconflow` keeps its name and still reads Models.dev through its address; one renamed from DeepSeek at `…/v1` now searches every Models.dev provider for its exact model ids. Reconnect it to take the new name.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/lib/provider-catalog.ts`, `docs/tech/architecture.md`, the `/docs` admins page.

## 2026-11-18 — Providers and models by their logos; publishing a model sets its rate

- **What:** `@dsh-teamwork/shared` holds the marks of the mainstream model makers and providers (OpenAI, Anthropic, Gemini, DeepSeek, Qwen, Kimi, GLM, Doubao, MiniMax, Llama, Mistral, Grok, Ernie, Hunyuan, Step, Baichuan, SiliconFlow, OpenRouter, Ollama; LobeHub's icons, MIT) and `providerMark`, which picks one from a model's id, name, provider or address. The console shows them wherever it names a provider or a model (models, team resources, presets, usage, My usage, a DSH session's model menu, whose `Select` options take an icon), as does the home page's diagram, whose `provider-logos.ts` is gone. Publishing from a provider's list looks each ticked model up as it is ticked and publishes it with the limits and reference rate its agreeing public reference states (a missing cache rate charged as uncached input), so it can be called at once; the per-model form in that dialog is gone, kept for a model ID typed by hand. The models page lists models with no rate and fills them all from reference prices in one click, and a rate dialog for an unpriced model opens filled. `mountWeb` takes `models`, a section an edition shows first on the models page for the models it supplies.
- **Why:** A team admin published a model and then had to open a second form per model to price it before anyone could call it; and a model was a name with no sign of whose it is.
- **Breaking:** `CatalogProvider` loses `mark`.
- **Upgrade:** Nothing.
- **Refs:** `packages/shared/src/providers.ts`, `apps/web/src/components/provider-mark.tsx`, `apps/web/src/pages/team/models.tsx`, `apps/web/src/lib/model-metadata.ts`, `docs/design.md` ("Icons"), `docs/tech/architecture.md`, the `/docs` admins page.
## 2026-11-18 — The sign-in page is redesigned

- **What:** `/sign-in` is a split screen: the navy plate with the title and a layered sea beside a form that lists each OAuth door the server reports in `doors` (Google today, with its four-colour G), then the email door. The code step becomes *Check your email* with a six-digit field and a *Send a new code* link; the password field can be shown; an instance whose first account is unclaimed points to the setup link; errors and pending buttons are visible as such.
- **Why:** The page was a bare card that did not look like the product and gave no feedback while a request ran.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/sign-in.tsx`, `docs/design.md`.

## 2026-11-18 — Browser analytics send page views and nothing else, whatever the project enables

- **What:** The browser's PostHog client turns off heatmaps, dead clicks and web vitals in its own config, and its filter (`scrubEvent`) drops every event but `$pageview`. Before, a PostHog project with those switched on in its settings made the client send `$web_vitals` and heatmap events.
- **Why:** `docs/ops/analytics.md` and the hosted privacy policy promise page views only; the project's remote settings could break that promise without a code change.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/lib/analytics.ts`, `docs/ops/analytics.md`.

## 2026-11-18 — A new session from the console lands in the team's default workspace

- **What:** `teamwork/configuration` gains `teamDirectories`, each synced team's default workspace on the computer, which the member sets in the plugin's panel under My teams (the folder DSH was started in until then). `relay-client`'s `createSession` takes a `teamId` and, naming no folder, starts there ahead of the latest session's folder (`defaultDirectory`); My DSH passes the console's team. `latestDirectoryOf` is removed.
- **Why:** A member in several teams keeps each team's work in its own folder; a phone or browser should open there without a choice each time.
- **Breaking:** None. A plugin that sends no `teamDirectories` behaves as before.
- **Upgrade:** Nothing; the plugin release that sends it is `@dsh-teamwork/dsh-teamwork` after 0.11.3.
- **Refs:** `packages/relay-client/src/session-config.ts`, `docs/tech/relay.md`, the plugin's `src/team-workspaces.ts`.

## 2026-11-18 — Team DSH is offline

- **What:** The server no longer mounts any Team DSH route: `/api/teams/{teamId}/shared-hosts…`, `/api/teams/{teamId}/shared-archive…`, `/relay/shared…` are 404, a host token opens nothing on the relay, and no member reaches a shared host. The console drops **Team DSH** from Workspace and Team assets, the home page drops its Team DSH card, and the `/docs` site drops the Team DSH guide and every mention of it. The code, the tables and the tests stay: `relay.Extension` takes `teamDSH`, false in the binary, true in the tests.
- **Why:** The feature is being reconsidered before anyone relies on it.
- **Breaking:** A running Team DSH loses its relay connection and cannot renew its host token; the one it holds still reaches `GET /api/configs` and the gateway until it expires, within the hour. Its plugin's `share` commands fail with 404.
- **Upgrade:** Nothing.
- **Refs:** `server/relay/relay.go`, `docs/tech/shared-dsh.md`.

## 2026-11-18 — An open console survives a deploy

- **What:** A request under `/assets/` for a file the build does not hold is a 404 instead of the console's HTML; the console reloads itself once when a chunk fails to load (`vite:preloadError`), and a route that still throws shows a reload card in the reader's language instead of React Router's developer page.
- **Why:** A tab opened before a deploy asked for its old chunks, got HTML back, and showed "Failed to fetch dynamically imported module".
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/web/web.go`, `apps/web/src/app.tsx`.

## 2026-11-18 — My usage replaces My submissions in the workspace; overruns apart from calls to resolve

- **What:** The workspace's sidebar lists **My usage** (`/teams/{teamId}/my-usage`) where **My submissions** was: the limits that apply to the reader, a period's (7, 30 or 90 days) calls, points and tokens, points by day and by model, and the latest calls with a CSV, for everyone, an admin's own included. My submissions stays at `/submissions`, a link on **Team resources** (its Chinese label now matches the English), which now holds every way to submit: upload a plugin, import a preset file, write a preset. A new `GET /api/teams/{teamId}/usage/stats` serves the page, scoped as the usage list is. The team summary adds `overruns` (calls past their hold, which suspend budgeted calls on their route) and no longer counts them in `unresolved`; the team overview lists them second, after unpriced models.
- **Why:** Submissions are sent rarely and followed from where they are sent; a member's own spend and limits had no page at all.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/my-usage.tsx`, `server/internal/usage/stats.go`, `docs/tech/usage-budgets.md`.

## 2026-11-18 — Every model call needs a reference rate

- **What:** The gateway refuses a call on a team model that has no reference rate for the provider and upstream model it calls now, whether or not a budget applies: `403 model_unpriced`, before any hold or upstream request. It replaces `budget_model_unpriced`. `GET /api/teams/{teamId}/summary?scope=team` adds `unpricedModels`; the team overview lists them first among what waits, getting started counts a model ready only once it is priced, and the models page marks each and leads with **Set rates**. Edition-funded models are unaffected.
- **Why:** Points must be known for every call, not only where a cap is set; unpriced calls also filled the admin's list of calls to resolve with ones nothing depended on.
- **Breaking:** A team with a model that has no rate, or whose rate was set for another upstream model, has its members' calls on that model refused until an admin sets one (zero is allowed). Clients reading the old error code see `model_unpriced`.
- **Upgrade:** Set a rate on every team model. Nothing else.
- **Refs:** ADR 0050, `server/internal/usage/admission.go`, `server/internal/usage/service.go`.

## 2026-11-18 — Admins land on a team overview; the home is everyone's own

- **What:** A team's console now opens an admin on **Team overview** (`/teams/{teamId}/overview`, heading Team management): what waits on the team, its last 30 days, getting started, its resources and the instructions for a new member. The workspace's **Home** moves to `/teams/{teamId}/home` and is the reader's own for everyone, admins included: their submissions under review, the limits that apply to them (said, not linked to a page a member cannot open), their own figures, the team's recent updates, and the DSH steps folded once their DSH has called. `/teams/{teamId}` redirects by role. `GET /api/teams/{teamId}/summary` returns the caller's own by default; `scope=team` returns the team's and needs an admin.
- **Why:** The home mixed an admin's team view with a member's own, so an admin could not see their own use and a member's budget alarm linked to a page that sent them home.
- **Breaking:** `GET …/summary` without `scope` now answers an admin with their own figures; the console asks for `scope=team`.
- **Upgrade:** Nothing.
- **Refs:** ADR 0049, `apps/web/src/pages/team/overview.tsx`, `server/internal/httpapi/usage.go`.
## 2026-11-18 — A Team DSH's audit records survive a crash

- **What:** The plugin appends each audit record to a journal on the DSH's disk as it is made, instead of holding up to a minute of them in memory, and seals what a stopped process left at the next start, never the same batch twice.
- **Why:** A crash of the plugin lost the records of the minute before it, a gap in the record the admin relies on.
- **Breaking:** None; the archive's format (ADR 0045) is unchanged.
- **Upgrade:** Release the plugin.
- **Refs:** the plugin's `src/audit-archive.ts`, `docs/tech/shared-dsh.md` ("The audit archive").

## 2026-11-18 — The web console chooses a model's reasoning effort

- **What:** Beside the model on My DSH and Team DSH, a model that advertises reasoning efforts offers them (or its own default), for a new session and for an idle one, through `teamwork/selectModel`, as the phone app does.
- **Why:** The browser could choose a model but not how hard it reasons.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/dsh-session.tsx` (`SessionSettings`), `docs/tech/relay.md`, the `/docs` members page.

## 2026-11-18 — The web console sends files

- **What:** On My DSH and Team DSH, a paperclip beside the composer adds files (the plugin's own limits and kinds), cards above the message show and remove them, and Send uploads them through the plugin's upload calls and submits them with the message, or alone; a message's files show in the conversation. The transfer rules move from the phone app into `@dsh-teamwork/relay-client` (`attachments.ts`), which both use. The web console transfers at Send; the app keeps transferring on selection.
- **Why:** Only the phone app could send a file to a computer.
- **Breaking:** None.
- **Upgrade:** Nothing; a plugin that takes no files shows no paperclip.
- **Refs:** `packages/relay-client/src/attachments.ts`, `apps/web/src/pages/team/dsh-session.tsx` (`useFiles`), `docs/tech/relay.md` ("File attachments"), `docs/tech/shared-dsh.md`, the `/docs` members page.

## 2026-11-18 — The web console chooses a session's folder, preset and model

- **What:** On My DSH and Team DSH, a new session offers the computer's folders, presets (one it cannot run yet shown with why, and not chosen) and models beside the composer before its first message, and a started session shows its folder and preset and changes its model while idle, for that session alone, as the phone app does. The console's `Select` gains disabled options.
- **Why:** The browser could only start a session with the computer's defaults, in its latest folder, and never change a session's model.
- **Breaking:** None.
- **Upgrade:** Nothing; a plugin that reports no configuration leaves the defaults, as before.
- **Refs:** `apps/web/src/pages/team/dsh-session.tsx` (`SessionSettings`), `docs/tech/relay.md`, `docs/tech/shared-dsh.md`, `/docs` members page.

## 2026-11-18 — Long sessions open from the phone and web (My DSH and Team DSH), and follows come back by themselves

- **What:** The plugin's bridge makes every frame it sends a phone or browser fit the encrypted channel's 1 MiB message: long strings are cut short, and a snapshot or `session/page` keeps its newest records and says `hasMore`. `@dsh-teamwork/relay-client` reads older history through `session/page` (`RelayClient.older`, the `older` event, `SessionState.earlier`), shown as "Show earlier messages" on the Team DSH page; and a follow whose socket, channel or computer went away retries with backoff and reopens with a fresh snapshot instead of ending.
- **Why:** A session with large tool output produced a snapshot over 1 MiB, which closed the channel, so it could never be opened remotely; and any dropped socket left the page showing an error until it was reopened.
- **Breaking:** `SessionState` has a required `earlier` and `RelayClient` an `older` method, so every implementation of either (the phone app's demo client) adds them.
- **Upgrade:** Release the plugin with this change; the oversized-snapshot fix lives there.
- **Refs:** `docs/tech/relay.md`, `packages/relay-client/src/live.ts`, the plugin's `src/bridge.ts` (`fitFrame`).

## 2026-11-18 — A device says what it is when it pairs

- **What:** The relay client takes the device it runs on (`device`: `ios`, `android` or `web`) and says it in `pairHello` and `shareJoin`, so a computer's Devices page can name each paired device: iOS phone, Android phone or Web browser. The console says `web`. My DSH and `/docs` point to the panel's page by its new name, Devices.
- **Why:** The plugin's panel said phone for every paired device, browsers included.
- **Breaking:** None; a computer whose plugin is older ignores the field, and a device paired before shows no kind.
- **Upgrade:** Nothing.
- **Refs:** `packages/relay-client/src/live.ts`, `apps/web/src/lib/relay.ts`; the plugin's `src/phone-security.ts`.

## 2026-11-18 — Team DSH is in every team's Workspace

- **What:** Workspace lists **Team DSH** in every team, not only once a member may reach one. Where the server has not enabled Team DSH for the team, the page says what it offers and that the platform operator enables it, sending an admin to support and a member to their admin; an admin of an enabled team with none is pointed to Team assets. `GET /relay/shared` adds `unavailableTeamIds`, and `@dsh-teamwork/relay-client`'s `sharedHosts()` answers `{ hosts, unavailableTeamIds }`.
- **Why:** The feature was invisible to the teams it was meant to reach first.
- **Breaking:** `sharedHosts()` answers an object instead of an array; its callers in this repository and the closed mobile app are updated.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/team-dsh.tsx`, `server/relay/access.go`, `docs/tech/shared-dsh.md`.

## 2026-11-18 — A Team DSH guide, and the console's key card says what comes next

- **What:** A new `/docs/team-dsh` page, in English and Chinese, takes an admin from installing DSH on a server to a member's first session, in shell commands (`dsh-teamwork share …`), with day-to-day tasks and troubleshooting; the admins page's Team DSH section now points to it. The console's Team DSH page links to it, and the key card shows the command in both forms (DSH's command input and a shell) and the steps that follow.
- **Why:** Admins setting up a Team DSH on a server had the commands scattered across three pages and a key card with one command.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/content/docs/{en,zh-CN}/team-dsh.md`, `apps/web/src/pages/team/team-dsh-hosts.tsx`.

## 2026-11-18 — A pasted pairing code keeps its last letter

- **What:** My DSH's pairing code field drops spaces before it holds the code to six characters, so a code pasted as the panel shows it ("PQP WGG") arrives whole.
- **Why:** The field's length limit cut the seventh character, the code's last letter, before the space was removed.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/my-dsh.tsx`.

## 2026-11-18 — My DSH opens the computer a pairing code came from

- **What:** When the code typed on one computer's page came from another of the member's computers (two records may share a name: two DSHs on one machine), My DSH now opens the computer the pairing belongs to once it confirms, instead of waiting on the first. Computers sharing a name show a short id beside it.
- **Why:** A member with two records named alike paired one and was left waiting on the other.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/my-dsh.tsx`.

## 2026-11-18 — My DSH says when pairing broke instead of waiting

- **What:** Pairing a browser on My DSH no longer waits forever when the encrypted channel to the computer fails before it accepts: it says so and starts again with a new code. A new e2e test pairs `packages/relay-client`, as the console runs it, with the plugin's own pairing code.
- **Why:** A member saw "approve this browser on the computer" stay on screen after approving it there.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/my-dsh.tsx`, `server/e2e/personal_pairing_test.go`.

## 2026-11-18 — An edition can choose which teams run a Team DSH

- **What:** `edition.Host` gains `GateTeamDSH` and `TeamDSHAllowed`. Where an edition sets a gate, a team it does not admit cannot create or rotate a Team DSH key (`403 team_dsh_unavailable`), its DSH gets no host token, and its members reach none; `GET /api/teams/{teamId}/shared-hosts` adds `available`, and the console's Team DSH page says the team is not enabled and offers no key. A self-hosted server sets no gate, so nothing changes there.
- **Why:** The hosted service opens Team DSH to chosen teams first, while its security is proven in use.
- **Breaking:** `GET /api/teams/{teamId}/shared-hosts` answers `available` beside `hosts`.
- **Upgrade:** Nothing.
- **Refs:** `server/edition/edition.go`, `server/relay/shared.go`, `server/relay/access.go`, `docs/tech/shared-dsh.md` ("Who may run one").

## 2026-11-18 — A Team DSH member can start a first session

- **What:** A computer's `teamwork/configuration` answer carries `directories`: the folder DSH was started in, then its workspaces. The relay client starts a new session in the reader's latest folder, else the first one offered, and accepts only those (`startableDirectories` in `packages/relay-client`), so the console's Team DSH page and the phone app work for a member with no session yet. On a Team DSH the plugin refuses a member's `session/create` in any other folder. `/docs` says to start `dsh web` in the project folder, and on pnpm 11 to let DSH's profile take a release from today and skip unneeded build scripts.
- **Why:** A client took the folder only from the reader's own sessions, and a Team DSH shows a member only theirs, so a new member got "no project folder on the machine" and could not start at all.
- **Breaking:** None. An older plugin offers no folders, so nothing changes against it.
- **Upgrade:** Update the plugin to 0.11.1 on each Team DSH, and restart DSH in the project folder.
- **Refs:** the plugin's `src/shared-owner.ts`; `packages/relay-client/src/session-config.ts`, `src/live.ts`; `docs/tech/shared-dsh.md`; `apps/web/content/docs/{en,zh-CN}/install.md`.

## 2026-11-18 — My DSH: a member's own computers in the web console

- **What:** Workspace → My DSH (`/teams/{teamId}/my-dsh`) lists the member's own computers, listed once one has connected. The browser pairs with one as the phone app does (code, safety code, approval on the desktop), unlocks it with the PIN, and drives its sessions end to end encrypted; each computer's devices, every phone and browser paired with it, are listed and removable. The relay adds `GET /relay/hosts` for the console's session, and `DELETE /relay/pairings/{id}` from that session revokes any pairing of the member's to their own computers (ADR 0048); an app token stays handset-scoped. Team DSH and My DSH now share their columns, conversation and PIN gate (`apps/web/src/pages/team/dsh-session.tsx`), and their shared messages moved to `team.dsh`. `/docs` (members) describes it.
- **Why:** A member could reach their own computers only from the phone app, and could remove a lost phone only at the desktop.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/adr/0048-the-console-manages-every-device.md`, `docs/tech/relay.md` ("My DSH in the web console").

## 2026-11-18 — Everything clickable shows the hand

- **What:** Buttons, menu items, options, disclosure summaries and the labels of checkboxes and file inputs show the pointer cursor from the base styles of the web app and of `/manage`; disabled ones keep the arrow. The per-component `cursor-pointer` classes are gone.
- **Why:** Tailwind 4 leaves buttons on the arrow, so most of the console looked unclickable on hover.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/globals.css`, `apps/manage/src/globals.css`, `docs/design.md` ("Component rules").

## 2026-11-18 — A question mark beside Team DSH says what it is

- **What:** The Workspace entry Team DSH carries a question mark whose hint says where the DSH runs, who manages it and who sees what (`nav.hints.teamDsh`). An edition's team page may carry one too (`TeamPage.hints`, per language).
- **Why:** Team DSH and the hosted edition's Cloud DSH sit side by side and read alike; the hint tells them apart.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/components/team/console-shell.tsx`, `apps/web/src/lib/edition.ts`.

## 2026-11-18 — A DSH can be run and managed from a Linux shell

- **What:** `/docs` describes installing DSH and the plugin on a Linux server (DSH needs its exact prerelease version) and the plugin's new `dsh-teamwork` command. It does what the Teamwork panel does against the DSH running on that machine, with no browser: the server, sign-in by pasted code, status, sync and sign-out, phone pairing (a QR code in the terminal, accepted after comparing the safety code), and a Team DSH's `share` actions (enable, audit-key, status, members, invite, unlock, disable). The plugin now keeps its files in `$DSH_HOME/dsh-teamwork/` (else `~/.dsh/dsh-teamwork/`) instead of the directory DSH was started from.
- **Why:** A DSH on a server, a Team DSH above all, has no desktop: the only way in was an SSH tunnel to DSH's web UI; and a Team DSH started from another directory lost its key, roster and PIN locks.
- **Breaking:** With the plugin release carrying this change, a signed-in DSH signs in again, and a Team DSH needs a new key (**Rotate key**) and fresh invites: files left in the old start directory are not moved.
- **Upgrade:** Update the plugin (`dsh plugin --profile web update --latest @dsh-teamwork/dsh-teamwork`), and on a server install its commands with `npm install -g @dsh-teamwork/dsh-teamwork`.
- **Refs:** the plugin's `src/teamwork-cli.ts` and `src/control-socket.ts`; `apps/web/content/docs/{en,zh-CN}/{install,commands,admins}.md`.

## 2026-11-18 — Shared DSHs are Team DSH, used in Workspace and managed under Team assets

- **What:** The console, `/docs` and every message call a shared DSH "Team DSH" in both languages. Using one and managing one are separate pages: Workspace's `/teams/{teamId}/team-dsh[/{computerId}[/{sessionId}]]`, listed in the navigation only when the team runs one the member may reach, lists the DSHs a member may reach, their sessions on the open one and the conversation in three columns, joins by invite and starts a session with its first message; Team assets' `/teams/{teamId}/team-dsh-hosts`, for the admin, keeps keys, access and the archive. `/teams/{teamId}/shared-hosts` is gone. A team page may fill the area beside the sidebar (`TeamPage.fill`, and the open pages' own `fill`), full height on a phone too.
- **Why:** "Shared DSH" read like the Workspace's "team shared" page, and a member's page mixed in the admin's keys and archive.
- **Breaking:** A bookmark to `/teams/{teamId}/shared-hosts[/…]` no longer opens. The API is unchanged.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/team-dsh.tsx`, `apps/web/src/pages/team/team-dsh-hosts.tsx`, `docs/tech/shared-dsh.md`.

## 2026-11-18 — Team resources has a new Chinese name

- **What:** The Workspace page listing what the team provides has a new zh-CN name, "team shared" rather than "team resources" (`team.nav.resources` in `zh-CN.json`); English stays "Team resources". `/docs` (zh-CN) follows.
- **Why:** In Chinese, "team resources" and the admin's "Team assets" group read as the same thing.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/messages/zh-CN.json`, `apps/web/content/docs/zh-CN/members.md`.

## 2026-11-18 — Team management folds at the foot of the sidebar

- **What:** The console sidebar's top group is **Workspace** (was Work), still the only one a member sees. A team admin's pages move to **Team management** at the foot of the sidebar, folded by default and opened by itself on one of its pages, in two groups: **Team assets** (models, presets, plugins, review, history), what the team publishes to its members' DSHs, and **Members and spend** (members, usage, budgets). An edition's `mountWeb` team page names its `group` (`work`, `assets` or `people`) in place of `audience`.
- **Why:** Nine management pages in one group under the work pages read as one flat list; folding them away at the foot keeps the workspace apart, and the two groups follow the two jobs an admin does.
- **Breaking:** An edition's team page passes `group` instead of `audience` (`admin` becomes `setup` or `people`).
- **Upgrade:** Nothing.
- **Refs:** ADR 0043, `apps/web/src/components/team/console-shell.tsx`, `apps/web/src/lib/edition.ts`.

## 2026-11-18 — Shared DSHs are finished: the panel, and the last decisions

- **What:** The plugin's Teamwork panel manages shared mode as `/teamwork share` does: turn it on with a team host key, set the audit key, see the members who may reach the DSH with their devices and locks, make an invite (link and QR code), unlock a member, turn it off. `docs/tech/shared-dsh.md` now describes what was built, with three decisions: the archive costs a team nothing on the hosted service with no limit, a deleted account's records stay in the team's archive, and a team may have any number of shared DSHs.
- **Why:** The last part of the shared DSH work, and the open questions it left.
- **Breaking:** None.
- **Upgrade:** Update the plugin for the panel.
- **Refs:** `docs/tech/shared-dsh.md`, the plugin's `src/web/TeamworkPanel.tsx` and `src/panel.ts`.

## 2026-11-18 — Every server sends the phone app its sign-in code

- **What:** `/plugin` accepts the official app's `redirect_uri`, exactly `dshteamwork://sign-in`, on every server with no setting, and nothing else beside the plugin's loopback address; `MOBILE_REDIRECT_URI` is removed, and the session's `mobileRedirectPrefix` is now `appRedirect`, that exact address. `/docs` tells self-hosters the app connects to their server.
- **Why:** The official app reaches self-hosted servers (ADR 0044, ADR 0046), which should need no variable whose only value is the app's own scheme.
- **Breaking:** A `redirect_uri` that merely started with the old prefix is refused. A deployment's `MOBILE_REDIRECT_URI` is ignored.
- **Upgrade:** Remove `MOBILE_REDIRECT_URI` where it is set.
- **Refs:** ADR 0046 (supersedes ADR 0010), `server/internal/wire/auth.go`.

## 2026-11-18 — Members reach a shared DSH from the web console

- **What:** **Shared DSHs** in the team console now shows every member the shared DSHs they may reach; pasting an invite joins this browser, and `/teams/{teamId}/shared-hosts/{computerId}` is the member's own sessions there, with the PIN, the conversation, answers and sending, end-to-end encrypted through the relay with a non-extractable WebCrypto key kept in IndexedDB. The relay admits the console by its session cookie: HTTP routes when no Bearer is sent (writes only from this site), and `/relay/phone` without a token only when the upgrade's `Origin` is `APP_URL`. `edition.Host.Session` no longer opens a session whose account still has an admin-set first password. The relay client gains `sharedHosts()` and each computer's `hostId`. `/docs` describes it.
- **Why:** Step 7 of `docs/tech/shared-dsh.md`: a member needs no phone to use the team's shared DSH.
- **Breaking:** An extension's session check refuses an account with an unchanged first password, as every core route already did.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/pages/team/shared-dsh.tsx`, `apps/web/src/lib/relay.ts`, `packages/relay-client/src/web-identity.ts`, `server/relay/relay.go`, `docs/tech/relay.md`.

## 2026-11-18 — The relay's client is an open package

- **What:** `packages/relay-client` (`@dsh-teamwork/relay-client`) holds the client side of the relay, moved from the closed phone app: the encrypted channel (the plugin's `secure-channel.ts`, byte for byte), the relay's frames, the live client with a WebCrypto AES-GCM default, DSH's Remote API read into session shapes, and the pure rules a session screen draws by. `server/e2e` now joins a shared DSH, is refused while locked and sets a PIN through this client, and checks its channel against the plugin's.
- **Why:** The web console becomes a relay client too (`docs/tech/shared-dsh.md`, step 7), and one copy serves both clients.
- **Breaking:** None.
- **Upgrade:** `pnpm install`.
- **Refs:** `packages/relay-client`, `docs/tech/relay.md`.

## 2026-11-18 — A shared DSH keeps an archive only the team's admin can read

- **What:** A shared DSH seals every frame its members exchange with it to the admin's audit key (HPKE, one-minute or 1 MiB segments in a signed hash chain) and uploads the segments to `POST /relay/shared/archive`; the server keeps them in `shared_archive_segments` until the team is deleted and cannot open them. The console's **Shared DSHs** page lists each archive and downloads it (`GET /api/teams/{teamId}/shared-archive[/{hostId}]`); `dsh-teamwork-audit keygen` and `read`, in the plugin's package, make the key and open a download. A shared DSH admits no member until `/teamwork share audit-key` is set. `/docs` describes it.
- **Why:** The team keeps a record of what members do on its machine without the server reading it (ADR 0045, `docs/tech/shared-dsh.md`).
- **Breaking:** A shared DSH already admitting members admits nobody new until its admin sets an audit key.
- **Upgrade:** One migration per dialect creates `shared_archive_segments`; the binary applies it at start. Update the plugin, then run `dsh-teamwork-audit keygen` and `/teamwork share audit-key` in each shared DSH.
- **Refs:** ADR 0045, `server/relay/archive.go`, the plugin's `src/audit-archive.ts` and `src/audit-cli.ts`.

## 2026-11-17 — A PIN locks every phone's channel to a DSH

- **What:** The plugin keeps a four-digit PIN per member (on a personal computer, its one owner) and refuses every call and stream from a phone's channel until the member sets or gives it, and again after fifteen idle minutes; five wrong PINs lock the member until `/teamwork share unlock <email>` or `/teamwork pin reset` clears it. The server sees none of it: the PIN goes inside the encrypted channel. `/docs` lists the two commands, and `server/e2e` has a joining member refused until they set a PIN.
- **Why:** A second lock on a phone that already proved its key (`docs/tech/shared-dsh.md`, "The PIN").
- **Breaking:** A phone app without the PIN screen can no longer use a computer whose plugin has it; both update together.
- **Upgrade:** Update the plugin and the app together.
- **Refs:** `docs/tech/shared-dsh.md`, the plugin's `src/pin-lock.ts`.

## 2026-11-17 — The relay admits members to a shared DSH

- **What:** A shared DSH's plugin connects to the relay with its host token and is sent who may reach it (`members`) at hello and at every ping; it cannot ask for a pairing code. Members list the shared DSHs they may reach (`GET /relay/shared`) and start a pending pairing with one (`POST /relay/shared/{hostId}/join`), which the DSH confirms once it has checked their invite. A team admin sets who may reach each one, the whole team or listed members (`PUT /api/teams/{teamId}/shared-hosts/{id}/members`, the console's **Access**); anyone taken off the list, or out of the team, loses their pairings with it. Deleting a shared DSH closes its socket.
- **Why:** Members reach a team's shared DSH through the server's list as well as the DSH's own roster (ADR 0044, `docs/tech/shared-dsh.md`).
- **Breaking:** None.
- **Upgrade:** One migration per dialect adds `shared_hosts.access` and `shared_host_members`; the binary applies it at start.
- **Refs:** `server/relay/access.go`, `docs/tech/relay.md`, `docs/tech/shared-dsh.md`. The plugin's roster, invites (`/teamwork share invite`, `members`) and session-owner filter land with it; `server/e2e` drives a member joining by invite. A pairing as the relay lists it now carries `userId`.

## 2026-11-17 — The relay is open: phone pairing and shared DSHs on every server

- **What:** The relay moved from the hosted edition into `server/relay`, an extension every binary's main imports: `GET /api/relay`, the `/relay/plugin` and `/relay/phone` sockets, phone pairing (`/relay/pair`, `/relay/pairings`), push through Expo, and shared DSHs (`/api/teams/{teamId}/shared-hosts`, `/relay/shared/challenge`, `/relay/shared/token`). Its tables (`relay_hosts`, `relay_pairing_offers`, `relay_pairings`, `shared_hosts`) join the open schema. The console gains **Shared DSHs** under collaboration, and `/docs` describes it.
- **Why:** A team's shared DSH must work on a self-hosted community server (ADR 0044).
- **Breaking:** None on a community server. The hosted service's pairings and shared hosts are not carried over (its own entry).
- **Upgrade:** One migration per dialect creates the relay's tables; the binary applies it at start. The plugin needs its shared-mode version for `/teamwork share`.
- **Refs:** ADR 0044, `server/relay`, `docs/tech/relay.md`, `docs/tech/shared-dsh.md`, `apps/web/src/pages/team/shared-hosts.tsx`.

## 2026-11-17 — The relay and shared DSHs join the community edition

- **What:** A decision, and the plan for it: the relay (phone pairing and end-to-end encrypted forwarding), shared DSHs and their audit archive move from the hosted edition into the open server and web app, and the closed phone app reaches any server. Nothing has moved yet; `docs/tech/shared-dsh.md` orders the work.
- **Why:** A team's shared DSH must work on a self-hosted community server (ADR 0044).
- **Breaking:** None yet. When the relay moves, the hosted service's pairings and shared hosts are not carried over.
- **Upgrade:** Nothing.
- **Refs:** ADR 0044, `docs/tech/shared-dsh.md`, `docs/tech/community-edition.md`.

## 2026-11-17 — Host tokens for a shared DSH

- **What:** A fourth sealed token kind, `auth.HostBearer`, minted only by an edition through `Host.MintHostToken` for a shared DSH: one team, no person, at most an hour. `GET /api/configs` returns that team alone (role `member`) and the gateway calls its models; no other route opens it. Its calls are recorded with `usage_requests.host_id` and an empty `user_id`, held to the team's and providers' budgets and to no member's; usage entries carry `hostId`, and the console's usage list names such a row "Shared DSH". `edition.FundingAdmission` gains `HostID`, so an edition funding hosted models sees which calls are a shared DSH's.
- **Why:** A team's shared DSH must sync its team and call its models without belonging to any member (ADR 0047).
- **Breaking:** `gateway.Completions` takes a `gateway.Caller` instead of a user id and team.
- **Upgrade:** One migration per dialect adds `usage_requests.host_id`; the binary applies it at start.
- **Refs:** ADR 0047, `server/internal/httpapi/identity.go`, `server/internal/gateway/gateway.go`, `server/internal/usage/admission.go`.

## 2026-11-17 — The home page explains shared workflows and team assets

- **What:** The opening copy explains sharing team models and workflows, with a labeled DSH plugin copy field. Both languages drop the edition label, and the English opening copy uses tighter type and spacing. Both languages share the same horizon position. The header links to the Teamwork plugin on GitHub. The first chapter gives an overview of how the whole team uses DSH, and the diagram shows Cloud DSH as a separate workspace in limited trial. Collaboration uses three steps and a review screenshot to show how an updated market research preset reaches the team. Team assets shows workflows from several roles and sample version records with approval actions, reviewers, and times. Desktop, browser, and phone are presented side by side. The phone preview matches the other frames on desktop and shows a status bar and check marks for iOS and Android. The open page shows shared DSH access by invitation, and the collaboration section covers sharing both workflows and a working environment. Governance answers three questions managers ask about budgets, security, and access. The pricing section compares free community self-hosting, prepaid model usage on Teamwork Cloud, and inquiries for enterprise private hosting. The home FAQ addresses plugin installation and compatibility, pricing, self-hosting, and how Teamwork handles conversations and provider keys.
- **Why:** Give each section one purpose and make the main story quicker to read.
- **Breaking:** None
- **Upgrade:** Nothing
- **Refs:** `apps/web/src/public/home.tsx`, `docs/design.md`.

## 2026-11-17 — The home page follows the whale from the surface to the seabed

- **What:** The home page pairs the logo’s indigo fluke with a white sky, two cloud banks and a blue engraved sea. The upper chapters use pale grounds before the dive into navy. Two traveling swells bend the engraved water around the whale fluke. The lower-right dive link scrolls smoothly to the opening chapter, *one person's work*. The opening fluke is engraved diagonally down to the right. A horizontally hatched humpback crosses behind the middle chapters, with a slow stroke that builds from its back to its tail. A viewport of open water separates the solitary whale from the other scenes during fast scrolls. Three solid whale silhouettes gather above a quiet, flat seabed, with a subdued blue-gray upper whale, a slightly darker second whale and an ink-blue calf. Tighter spacing above the closing invitation and two shallow sediment layers lead into a compact footer with the whale logo and name on the left and navigation on the right. Its rightmost link is underlined, points up and scrolls back to the surface. The layout follows the same dive on phones, with still artwork for reduced motion.
- **Why:** The brand's dive connects a member's work with the assets the team keeps, while each product section stays readable.
- **Breaking:** None
- **Upgrade:** Nothing
- **Refs:** `apps/web/src/public/sea.tsx`, `docs/design.md`.

## 2026-11-17 — The home page's first screen, redrawn around what a team gains

- **What:** The first screen fills the window with the hero centred above the wave line, and every section widens to `max-w-7xl`. Its left side is the title, one sentence and the plugin to copy (*Create a team* stays in the header; the three pillars are gone). The diagram keeps its layout with a compact hub listing the four features, each with one line of value; the lines carry no words. An amber pulse loops the story (the admin publishes, every member's card ticks, a call goes out to a model), and hovering a feature dims what it does not involve. The upstream column is one list of mainstream providers by their logos (Anthropic, OpenAI, DeepSeek, GLM, Kimi, and your own), copied from LobeHub's icons into `provider-logos.ts`; the phone shows the app's logo, and the Chinese page names its people in Chinese.
- **Why:** The old first screen read as an architecture diagram with crowded copy; a first-time visitor should see in one look that a team configures once and everyone gets it, under control.
- **Breaking:** None
- **Upgrade:** Nothing
- **Refs:** `apps/web/src/public/home.tsx`, `topology.tsx`, `provider-logos.ts`, `sea.tsx`, `apps/web/src/globals.css`, `docs/design.md` ("The landing page's first screen").

## 2026-11-17 — A language switch in the home page's header

- **What:** The home page's header carries the language menu beside the theme button, opening downwards; the footer keeps its own.
- **Why:** A visitor who lands in the wrong language can switch without scrolling to the foot of the page.
- **Breaking:** None
- **Upgrade:** Nothing
- **Refs:** `apps/web/src/public/controls.tsx`, `apps/web/src/public/home.tsx`.

## 2026-11-17 — Model information and reference prices fill in one click

- **What:** **Fill from public catalog** (model forms) and **Fill reference prices** (the rate form, estimated-cost basis) fill at once from the one catalog entry whose id is the model's own, and a note says where the values came from, what changed and, for prices, the exchange rate and its date, with an undo. No match, or the same id at several providers, changes nothing and offers a picker. The price multiplier is gone. `POST /api/teams/{teamId}/model-metadata/lookup` no longer requires `provider`; for Models.dev, one the catalog does not name searches every provider by exact id.
- **Why:** Choosing a source, a provider and a candidate before anything filled was slow for the common case, and a team's rates are its own budget shares, not resale prices that need a multiplier.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/components/team/model-metadata.tsx`, `server/internal/httpapi/model_metadata.go`, `docs/tech/usage-budgets.md`.

## 2026-11-17 — The team console is work first

- **What:** A team's sidebar has two groups: Work for everyone (Home, Team resources, My submissions, an edition's work pages) and Team management for its admin alone (models, presets, plugins, Review, history, members, usage, budgets); a member opening a management page is sent home. Team resources lists the models (with their rates), presets and plugins, and is where a member proposes a preset or a change to one. A member leaves from the team switcher. An edition's team page (`mountWeb`) names its `audience`, `work` or `admin`, and may give `visible(team)`, answered by the edition's own API, for a page only some teams have. `GET /api/teams/{teamId}/submissions` takes `mine=true`.
- **Why:** Most people who open a team work in it; cloud sessions, for every member of a team the operator admits, are the first edition work page.
- **Breaking:** An edition's `mountWeb` team page must name its `audience` (`work` or `admin`), and may give `visible(team)` for a page only some teams have. Members no longer see usage, budgets, history, or the models, presets and plugins management pages.
- **Upgrade:** Nothing.
- **Refs:** ADR 0043, `apps/web/src/lib/edition.ts`, `apps/web/src/components/team/console-shell.tsx`, `apps/web/src/pages/team/resources.tsx`.

## 2026-11-17 — Editions can store objects in the server's store

- **What:** `edition.Host.Objects` lends an edition the server's own object store (the data directory, or the `ARTIFACT_STORAGE_PROVIDER=s3` bucket) under keys `teams/{teamId}/{kind}/{id}`, beside the plugin archives and never among them (`plugins` is refused). `Put`, `Open` (a missing object is `fs.ErrNotExist`) and `Delete`; nil on a management process.
- **Why:** The hosted edition keeps each cloud session's record after its VM ends, in the store that already holds plugin archives rather than in a bucket of its own.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** ADR 0042, `server/internal/artifactstore`, `server/edition/edition.go`.

## 2026-11-17 — `apps/web`, one development address, and editions compose the web app

- **What:** The user frontend is `apps/web` (`@dsh-teamwork/web`) and the shared management app `@dsh-teamwork/manage`. `pnpm dev` runs the edition's outermost Go server on :3800 with `DEV_VITE=1`, which takes the console, its modules and the public pages from the web Vite on :3810 and `/manage` from the management Vite on :3811; Go sources, migrations and embedded JSON restart the server. An edition's web app composes the open one through `mountWeb` (`@dsh-teamwork/web/app`): it adds routes and team pages, replacing an open one at the same path, and adds or replaces public pages by file name, which the server now serves generically (`/{name}` from `{name}.{locale}.html` or `{name}.html`, also in the sitemap). `Host.SetWebConsole` hands the server an edition's web build. `Host.AddTeamPage` and the session's `teamPages` are removed.
- **Why:** One origin in development, as in production, so the web app and the management console run together and the public pages' routing exists once, in Go; and closed member pages become routes in the open console's shell rather than separate apps (ADR 0041).
- **Breaking:** `apps/console`, `@dsh-teamwork/console` and `@dsh-teamwork/manage-core` are gone; use the new paths and names. `GET /api/auth/session` no longer has `teamPages`, and editions lose `Host.AddTeamPage` (the closed billing page moves into the closed web app in the same change). Without legal pages, `/privacy` and `/terms` are the console's like any unknown path, rather than 404.
- **Upgrade:** Run `pnpm dev` and open `http://localhost:3800`; nothing else listens for the browser. Production builds and deployment are unchanged.
- **Refs:** ADR 0041 (supersedes 0028), `scripts/dev.mjs`, `server/scripts/dev.mjs`, `server/internal/web/web.go`, `apps/web/src/app.tsx`, `apps/web/scripts/vite-pages.mjs`, `apps/web/scripts/prerender.mjs`.

## 2026-11-17 — Live model metadata and price form suggestions

- **What:** Team model publication/editing can query Models.dev or OpenRouter, select a reference model and apply context/output limits and image support. Known domestic providers default to their Models.dev China-specific namespaces. Rate forms automatically convert supplier USD prices using live Frankfurter USD/CNY FX, apply a multiplier and round suggestions up to readable values. The plugin respects the saved optional `vision` flag.
- **Why:** Administrators can fill model specifications and reference prices without copying them manually or entering exchange rates.
- **Breaking:** None. Existing configurations keep their values and unknown capabilities remain unspecified.
- **Upgrade:** Nothing. No migrations, scheduled jobs, local catalog, persistent cache or upstream associations.
- **Refs:** `server/internal/httpapi/model_metadata.go`, `apps/web/src/components/team/model-metadata.tsx`, `docs/tech/architecture.md`, `docs/tech/usage-budgets.md`.

## 2026-11-17 — Presets are listed as rows, and a plugin pin needs only its package

- **What:** The console's presets are one list of rows instead of two columns of cards, as `docs/design.md` asks of lists; the templates below stay cards. Pinning a plugin asks for the npm package and version first, and its name defaults to the package.
- **Why:** Uneven card heights, and a name field that was easy to fill with the wrong thing.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/pages/team/presets.tsx`, `apps/console/src/pages/team/plugins.tsx`.

## 2026-11-17 — The landing page's first screen: three pillars, a diagram, and real screens below

- **What:** The hero drops its two buttons and its install card. On the left: one sentence, the three pillars (collaborate, govern, everywhere), *Create a team* with the plugin's package to copy, and a line to the install guide. On the right: a left-to-right diagram of how a team uses DSH Teamwork (`apps/console/src/public/topology.tsx`). Real captures of DSH Desktop's Teamwork panel, the web console, the phone app, the review comparison and the usage page, one set per language in `apps/console/public/home/`, now illustrate the *Everywhere*, *Collaborate* and *Govern* sections, replacing their text-only cells and the terminal transcript.
- **Why:** The first screen repeated the top bar's actions, buried installing, and showed no product; screens crowded into it were too small to read.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/public/home.tsx`, `apps/console/src/public/topology.tsx`, `docs/design.md`.

## 2026-11-17 — The console names its terms and offers only what the instance can do

- **What:** The Chinese console translates Provider and Key with the terms `/docs` already uses, instead of leaving them in English. Usage explains points (the team's own measure of cost, CNY 1 = 1,000 points at the reference rates, counted by budgets) and that a provider still bills its own key directly, in place of "BYOK". A budget form on an instance that sends no email offers no notification choice and creates the policy notifying nobody. A new budget reports "Budget created", not "updated". English budget labels write "token" in lower case, and the Chinese home page's eyebrow is no longer forced to capitals.
- **Why:** Terms a reader did not know, a mixed-language Chinese screen, and an email option that could never send.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/messages/`, `apps/console/src/pages/team/budgets.tsx`, `apps/console/content/docs/*/admins.md`.

## 2026-11-17 — A provider key is checked before it is saved; a new member is not asked for the password just used

- **What:** `POST /api/teams/{teamId}/providers/check` reads a model list with a typed address and key without saving either. The console calls it before connecting or re-keying a provider, so a key the provider answers 401 or 403 to (`provider_key_rejected`, also from `model-catalog`) or a refused address stays on the form beside its field. `provider_address_refused` is replaced by its reason: `provider_address_private`, `provider_address_plain_http`, `provider_address_unresolved`. A session that signed in with an admin-set password changes it without the current one (`ChangePassword.current` is optional; the session's user gains `changeWithoutCurrent`); a session issued before an admin reset still needs it. After that change a member in one team lands in it. The first password and the plugin's code have copy buttons; the plugin's authorization page names the account and how many teams it reaches, and offers Cancel. A wrong `/setup` token is `setup_link_invalid`, no longer `setup_closed`.
- **Why:** A wrong key was announced as connected; a refused address did not say why; a new member retyped a twenty-character password they had just used; the authorization page did not say who was being authorized.
- **Breaking:** `provider_address_refused` is gone; a client matching it matches the three reasons.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/team/network.go`, `server/internal/team/providers.go`, `server/internal/auth/auth.go` (`FirstPasswordProven`), `apps/console/src/pages/team/models.tsx`, `apps/console/src/pages/plugin.tsx`, `docs/tech/architecture.md`.

## 2026-11-17 — A new team's assistant is named in its creator's language

- **What:** Creating a team names its built-in assistant, and writes its description, in the creator's language by the pages' rule (profile, cookie, `Accept-Language`): `Acme assistant` in English, the Chinese form in Chinese. It was always the Chinese suffix. `web.ViewerLocale` is exported for the route, and `team.Service.CreateTeam` takes the locale.
- **Why:** English consoles and the now bilingual DSH panel showed every new team's assistant with a Chinese name.
- **Breaking:** None. Existing assistants keep their names; an edition calling `CreateTeam` passes a locale.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/team/assistant.go`, `server/internal/team/assistant.json`, `docs/tech/team-assistant.md`.

## 2026-11-17 — Analytics count pages only; the app's token can delete the account

- **What:** The server sends nothing to PostHog any more: the `user_signed_up` and `profile_updated` events and `server/internal/analytics` are gone. The browser stays cookieless and anonymous and now sends `$pageview` only, with page leaves off. `DELETE /api/profile` also takes a Bearer token with the email typed back, so the phone app can delete the account in place; the `browser_only` refusal is gone.
- **Why:** No tracking of what a person or an account does; the App Store requires in-app account deletion.
- **Breaking:** PostHog receives no account events from now on; queries over them stop growing. A plugin token can delete its account given the account's email.
- **Upgrade:** Nothing. `POSTHOG_KEY` keeps its meaning for the browser.
- **Refs:** ADR 0040, `docs/ops/analytics.md`, `apps/console/src/lib/analytics.ts`.

## 2026-11-17 — The operator console follows the visual system

- **What:** The operator console's rail ends in the operator's initial, the theme and signing out, with the address only on hover; `@dsh-teamwork/manage-core` exports the console's custom `Select` (`./components/ui/select`) so an edition's pages draw no native select. The landing page's Chinese install line names DSH Desktop's menu as the app does, `Plugins → Add plugin`.
- **Why:** The last screens that printed an email in the chrome or drew a native select; the install line now matches the plugin's own guide.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md`, `apps/manage/src/components/layout/sidebar.tsx`, `apps/manage/src/components/ui/select.tsx`.

## 2026-11-17 — People can delete their own account, and an admin can hand the role over

- **What:** `DELETE /api/profile` (browser session, email typed back as `confirm`) deletes the account, its identities, password and memberships, and every team it is alone in with all of that team's rows and artifact bytes. It is refused (`admin_of_shared_team`) while the account administers a team with others in it; `POST /api/teams/{teamId}/members/{userId}/admin` hands the admin role to a member, and the caller becomes a member. Editions hear `TeamDeleted` and `AccountDeleted` through `Host.SubscribeTeams` and may refuse. The account page gets a Delete account section; the members page gets Make admin.
- **Why:** Deletion was by email only, and a team's one admin had no way to leave it.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** ADR 0039, `server/internal/team/account.go`, `apps/console/src/pages/account.tsx`.

## 2026-11-17 — The review and history pages show changes field by field

- **What:** `GET /api/teams/{teamId}/submissions` takes a `state` filter. Sharing and review opens on the review queue for an admin (on a member's own submissions otherwise), with the other view one tab away; submitting a preset or a plugin is a dialog with a drop zone (a plugin archive is still inspected in the browser and checked by digest); each submission is a row that opens to show its change field by field against the live version, and approve, reject (reason required) and withdraw confirm in a dialog. Versions and backups is a timeline with one row of filters (kind, resource, author, any / 7 / 30 days / a custom range of whole days); the live version is marked, any other shows what restoring it would change, and restoring confirms in a dialog that links to review.
- **Why:** Both pages were native file inputs, raw JSON side by side and inline confirmations.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/pages/team/sharing.tsx`, `apps/console/src/pages/team/history.tsx`, `apps/console/src/lib/config-diff.ts`, `docs/tech/team-assistant.md`.

## 2026-11-17 — A management process no longer prints or accepts the first-account link

- **What:** With `SERVICE_ROLE=manage`, the server no longer prints `/setup?token=…` at start and no longer serves `POST /api/auth/setup`. The combined and user processes keep both, so a single-process install's first run is unchanged.
- **Why:** A management service with no email door fell back to passwords and wrote a live first-account link into its log on every start, where a hosting provider's log viewer shows it, although its accounts are claimed on the shared database where members sign in.
- **Breaking:** None for a single-process install. A split install claims its first account on the user process.
- **Upgrade:** Nothing. A link already printed by a management process stops working there once it is updated.
- **Refs:** `server/app/app.go`, `server/internal/httpapi/server.go`, `docs/tech/system-management.md`.

## 2026-11-17 — Computer tokens for a cloud computer's plugin

- **What:** A new kind of sealed Bearer, the computer token: one member, one team, at most an hour, minted only through `edition.Host.MintComputerToken` for a member of that team. `GET /api/configs` returns that team alone for it, the model gateway refuses any other team's model, and every other route treats it as nobody. Membership is re-read on every request.
- **Why:** An agent in a cloud computer can read the plugin's token; a member's 30-day plugin token would let it act as the member everywhere.
- **Breaking:** None. `Gateway.Completions` takes the caller's team scope.
- **Upgrade:** Nothing.
- **Refs:** ADR 0038.

## 2026-11-17 — A redesigned /teams, a wider landing page, a theme switch and one select

- **What:** `/teams` gets the site's top bar and footer, team cards (initials on navy, with overview, models and members one click away) grouped by role, a welcome with the first steps for a person with no team, and create/join in dialogs; an `?invite=` link opens the join dialog filled in. The landing page widens from `max-w-5xl` to `max-w-6xl`. A theme button switches between light and dark (the system's setting until a person chooses; the choice is kept in `localStorage` under `theme`, the instance console's key, whose own picker drops its "system" option) and sits in the top bar and footer of the landing page, the docs and `/teams`, and beside the account in a team's sidebar; the first paint follows it. The person is shown by their avatar: a team's sidebar ends in a row of avatar, name and role (after Router9 Studio's rail) and top bars show the avatar alone, both leading straight to a new account settings page (`/account`: name edited in place, email, language, light or dark, password where the instance holds passwords, your teams, sign out). The account dropdown is gone, and the email is printed only on that page. Every native `<select>` is replaced by one custom select (`components/ui/select.tsx`), the language picker included; the public pages draw the same look without React. The old picker's menu was transparent (`bg-popover` is not a token); it now uses the card surface.
- **Why:** The teams page was a narrow column with forms always open, the theme could not be chosen, and native selects broke the visual system.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/pages/teams.tsx`, `apps/console/src/lib/theme.ts`, `apps/console/src/components/ui/select.tsx`, `apps/console/src/public/controls.tsx`, `docs/design.md` ("Colour", "Component rules").

## 2026-11-17 — The team overview opens with what waits on you

- **What:** `GET /api/teams/{teamId}/summary` returns, scoped to the caller, the last 30 days' calls and points, calls left unpriced, calls an admin must resolve, budget mail that failed, budget windows past a notice threshold (80, 95, 100 %), the caller's quota summary and submissions awaiting review. The console's overview opens with that list (each row links to the page that deals with it) and a strip of figures, keeps the getting-started checklist only until it is done, and explains joining in three steps with a copyable message for new members. An admin's sidebar marks "Sharing and review" with an amber dot while submissions wait.
- **Why:** The overview counted configuration rows and could not say what needed doing.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/usage/summary.go`, `apps/console/src/pages/team/overview.tsx`, `docs/tech/usage-budgets.md` ("API and console").

## 2026-11-17 — Editions can register meters with the budget engine

- **What:** An edition registers its own kinds of usage (`edition.Host.RegisterMeters`): it holds points for a member before metered work starts and settles the measured quantity and its points afterwards, in the same windows, reservations and transaction as model calls, with its funding participant. Team and member point budgets bound them; provider budgets and token limits do not. `usage_requests` gains `meter` and `quantity`; the usage API's entries gain `meter`, the CSV export gains `meter`, `quantity` and `unit`, and the console's Usage page names a metered row by its labels. An unsettled hold is marked lost and stays held; an administrator cannot resolve a metered row.
- **Why:** The hosted edition's cloud computers must count against the same member and team budgets as model calls, without a second budget engine.
- **Breaking:** None. The CSV export has three more columns at its end.
- **Upgrade:** One migration, applied at start. Nothing else.
- **Refs:** ADR 0036, `docs/tech/usage-budgets.md` ("Edition meters").

## 2026-11-17 — Documentation at /docs, and a one-line install on the home page

- **What:** Every instance publishes user documentation at `/docs` in English and Chinese: an overview, installing the plugin (Desktop, CLI and web, signing in, choosing the server, common problems), setting up a team, working in one, the command reference, and running your own server. Pages are Markdown in `apps/console/content/docs/{locale}/`, prerendered with the other public pages and served in the viewer's language like the home page; the sitemap lists them. The home page's first screen now shows one line for installing from DSH Desktop and links to the full guide; its header and footer link the docs, and the self-hosting guide button opens `/docs/self-hosting`. The community edition is no longer described as installable from npx, which is not published.
- **Why:** Installing the plugin is the step everything else depends on, and it needs more than a first screen can hold.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/public/docs.tsx`, `apps/console/content/docs/`, `server/internal/web/web.go`, `CLAUDE.md` ("Language", "In this repository").

## 2026-11-17 — The landing page tells the team story; the console's sidebar is grouped

- **What:** The home page is rewritten around "from super individual to super team": what changes when a team shares its agents, every platform the team works on (terminal and web console available, the mobile app on the hosted service, DSH in the cloud marked as coming), collaboration (presets, plugins, the team assistant, share and review), governance (budgets, usage, keys, membership) and, on the deep floor, the team's assets (versions, restore, export). Its primary call is "Create a team", with "Run it yourself" beside it. Narrow screens get a section menu. The FAQ no longer says a person can be in one team only, and states where provider keys really live. The team console's sidebar groups its pages into Team assets, Collaboration and Governance, gives each page its own icon, moves the account, password, language and sign-out into one menu, and becomes a sheet on narrow screens.
- **Why:** The page described only configuration sync, while usage, budgets, reviewed sharing, history and the assistant had shipped; and the flat nine-item sidebar mixed what a team publishes with what it governs.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/console/src/public/home.tsx`, `apps/console/src/components/team/console-shell.tsx`, `docs/design.md` ("Component rules").

## 2026-11-16 — Neutral black-and-white palette with navy and amber accents

- **What:** The web app and the console drop the warm paper and indigo-tinted scale for neutral greys: black primary buttons in light, white in dark, the same frame as DeepSeek Harness. `--brand` stays navy and marks team identity only; a new `--signal` (amber) marks what needs attention. The landing page drops its navy ocean for a black wave line with the fluke faint behind it and one navy closing band; the console's selected section is a grey fill with a navy bar, and pending reviews carry an amber dot. The share card is drawn on white.
- **Why:** Teamwork lives inside DSH; a neutral frame lets the plugin, the web app and the mobile app read as one product with it, while navy and amber set the team edition apart.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md` ("Colour", "Component rules"), `apps/console/src/globals.css`, `apps/manage/src/globals.css`, `apps/console/src/public/home.tsx`.

## 2026-11-16 — The brand mark's fluke rises from a layered sea

- **What:** The mark's thin wave line becomes a full sea in three tones (deep water, a light surface, two swell bands) that covers the fluke's stalk; the fluke keeps its size and the surface its height. Every icon and logo is re-exported.
- **Why:** The stalk cut off below a thin line read as a severed tail.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** ADR 0035, `docs/design.md`, `docs/brand/icon.svg`.

## 2026-11-16 — Bilingual product documentation and self-hosting guide

- **What:** English-first and Simplified Chinese user READMEs explain team resources, reviewed sharing, service boundaries and supported installation paths. A self-hosting runbook covers retained local/S3 artifacts, verification and consistent backups.
- **Why:** Members and self-hosted teams need a usable first-run path and documentation that distinguishes the published DSH plugin from the unreleased server package.
- **Breaking:** None.
- **Upgrade:** No application migration or configuration change. Documentation checks allow only the requested root Chinese README and its language-navigation label.
- **Refs:** `README.md`, `README.zh-CN.md`, `docs/ops/self-hosting.md`.

## 2026-11-16 — Team-scoped private plugin paths

- **What:** Both storage providers use `teams/{teamId}/plugins/{artifactId}.tgz`. Startup and authenticated reads migrate referenced flat objects with size/SHA-256 verification; `--migrate-artifact-paths` runs the same pass offline.
- **Why:** Team-owned prefixes enable inventory and future cleanup without weakening authorization or losing existing archives.
- **Breaking:** Physical keys change; database identity and API URLs do not. Returning to an old binary requires verified flat copies of uploads made after this upgrade.
- **Upgrade:** Keep database/store backups and existing credentials. Startup verifies/migrates existing records before serving, retaining flat sources; missing or corrupt bytes stop readiness. No schema migration. Keep old copies until old writers retire; no automatic cleanup is introduced.
- **Refs:** ADR 0034, `docs/tech/team-assistant.md`.

## 2026-11-15 — Local and S3 private artifact storage

- **What:** Private plugin uploads, downloads, approval and backups use local-directory or S3-compatible storage. Environment variables select the provider; an offline migration command copies and verifies retained bytes.
- **Why:** Hosted archive files must survive container replacement, while community deployments keep a local default.
- **Breaking:** None; local directory keys and API metadata are unchanged.
- **Upgrade:** Local installations need no change. To select S3, provision a private bucket, configure `ARTIFACT_STORAGE_PROVIDER=s3` and its `ARTIFACT_S3_*` variables, stop writes and run `--migrate-artifacts` against the retained local directory before switching. Preserve database and archive backups together.
- **Refs:** ADR 0033, `docs/tech/team-assistant.md`.

## 2026-11-15 — Edition actions in the instance team directory

- **What:** The shared management console accepts team actions in directory rows and detail headers.
- **Why:** Editions can link a selected team to their operations without copying the directory.
- **Upgrade:** Nothing; the community default is unchanged.
- **Refs:** `docs/tech/system-management.md`.

## 2026-11-15 — Community instance management and explicit service roles

- **What:** Platform owns the shared `/manage` console and administrator API, user/team directories, instance counts and non-secret diagnostics. Editions extend its routes and UI. `SERVICE_ROLE` selects combined, user or management surfaces.
- **Why:** Self-hosted teams need instance administration, while separate operator services must not expose member workloads.
- **Breaking:** Isolated user processes refuse management; management processes refuse team APIs, plugin authorization and model calls. An instance administrator is an explicit `ADMIN_EMAILS` entry, not a team role.
- **Upgrade:** Build both console apps before embedding. Set `ADMIN_EMAILS`; optionally choose `SERVICE_ROLE`. No database migration. Separate user and management services share the database and provider encryption key but retain distinct session secrets.
- **Refs:** `docs/tech/system-management.md`, ADR 0032.

## 2026-11-15 — Reviewed resource sharing and historical backups

- **What:** Members submit preset/plugin creations and updates; admins approve frozen revisions. Direct admin writes share transactional history. Private archives are inspected, digest-pinned and access-controlled. Time-based history supports comparison, resource/dependency export and reviewed restoration, including deleted resources and retained plugin pins. Host-approved assistant tools connect sharing and supported management operations.
- **Why:** Teams need local-resource sharing without granting publication rights, and recoverable updates with exact plugin bytes.
- **Breaking:** Sync adds referenced historical plugin metadata. Publish the matching plugin with the server; new private archives are not public npm packages.
- **Upgrade:** Apply all append-only migrations and persist/back up both the database and the data directory's artifacts. Existing configs receive a legacy baseline before their first edit/deletion. Retained history is not automatically purged.
- **Refs:** `docs/adr/0030-reviewed-resources-and-publication-history.md`, `docs/tech/team-assistant.md`.

## 2026-11-15 — Default team assistant and inherited preset models

- **What:** Team creation includes a uniquely identified assistant preset. Presets may explicitly inherit the session model. The console and plugin preserve this choice, and scoped assistant tools read team resources, usage, budgets and membership or sync configuration.
- **Why:** New teams need an entry point that works before they configure a team model.
- **Breaking:** Config names accept up to 120 characters; preset data adds an exclusive inherited-model choice.
- **Upgrade:** Apply the new migrations on all three dialects and update the plugin with the platform. Existing teams are not automatically modified.
- **Refs:** `docs/tech/team-assistant.md`.

## 2026-11-15 — Linux CI with community distribution checks owned by Platform

- **What:** Both repositories run CI on Linux. Platform packs and smoke-tests npm packages in one job and owns Docker self-host verification; downstream editions retain the full integrated build gate. New runs cancel older runs for the same pull request or branch.
- **Why:** Avoid repeating community packaging and self-host checks in downstream editions, and remove the macOS/Windows runner matrix and artifact transfer between packing and installation.
- **Upgrade:** No runtime or database change. Release artifacts still target all supported platforms; routine CI installation checks exercise Linux only.
- **Refs:** `.github/workflows/ci.yaml`, `docs/tech/community-edition.md`.

## 2026-11-15 — Member quota summaries for companion clients

- **What:** Budget reads include the authenticated member's effective point availability after holds, token-cap status and uncertain usage. Administrator summaries exclude other members and provider-specific caps; reads create no accounting windows.
- **Why:** Companion clients need a small advisory display without reimplementing budget inheritance or claiming a prepaid wallet is a usage allowance.
- **Upgrade:** No schema change. Clients must still handle provider constraints at actual admission and treat an unknown summary as unavailable.
- **Refs:** `docs/tech/usage-budgets.md`.

## 2026-11-15 — Edition team pages in console navigation

- **What:** Installed editions register same-origin team page prefixes and localized labels. Session metadata exposes the entries, the sidebar keeps the selected team, and public sign-in returns load the edition document instead of falling through to the team list.
- **Why:** Separately embedded member apps need a discoverable entry without importing closed code or introducing another authentication flow.
- **Upgrade:** Session responses include an empty `teamPages` array on community installations. Navigation registration grants no API permissions.
- **Refs:** `docs/adr/0028-edition-team-navigation.md`.

## 2026-11-15 — Transactional edition team provisioning

- **What:** Edition subscribers receive actual team creation and member joins inside the public mutation transaction, through an owner-scoped borrowed SQL executor. Creation includes the true creator and emits no additional join. Both member-addition paths propagate callback failure before commit.
- **Why:** Edition records must not be lost after a membership commits or duplicated by browser retries.
- **Upgrade:** No schema change or community subscriber. Handlers run only for new mutations and must keep SQL work short; external work requires an extension-owned durable work item.
- **Refs:** `docs/adr/0026-transactional-team-events.md`.

## 2026-11-15 — Optional model funding shares budget transactions

- **What:** A named edition participant supplies protected model routes and immutable retail quotes, then reserves and settles through the public accounting transaction. The host lends a transaction-bound executor, team permissions and scoped model publication. Missing participants fail closed; BYOK never invokes funding. Hosted reconciliation is operator-only, and every strict request retains its admitted bounds even without a team policy. The console displays protected prices as read-only.
- **Why:** A separate prepaid check can overspend or leave wallet and budget counters inconsistent after failure.
- **Upgrade:** The binary applies the append-only route/bound migrations. Community installations register no funding participant and keep their existing BYOK behavior. No hosted credit or payment processor is activated by this change.
- **Refs:** `docs/adr/0024-atomic-model-funding.md`, `server/edition/funding.go`.

## 2026-11-15 — Community budgets, recovery and usage export

- **What:** Daily/monthly team, per-member default/override and provider point/token caps reserve atomically before dispatch and settle against immutable prices. Policy edits preserve consumption; timezone changes wait for a boundary. The console adds budget management, scoped CSV exports, explicit estimated reconciliation and optional 80/95/100 percent SMTP alerts with retry history. Lost calls retain their holds; observed bound overruns suspend the route until reviewed.
- **Why:** Teams need enforceable usage governance independently of hosted prepaid balances.
- **Breaking:** Enabled hard budgets require a verified route: initially direct DeepSeek text/function calls. Other BYOK routes remain measurable with enforcement disabled. Full-context input reservations are conservative; a small remaining allowance may not admit even a short prompt.
- **Upgrade:** The binary applies the new public migrations. Existing teams have no automatic caps. Configure model reference rates, then budgets. Existing SMTP settings enable budget mail; without SMTP use the console. No wallet or live payment is enabled.
- **Refs:** `docs/adr/0023-community-budget-reservations.md`, `docs/tech/usage-budgets.md`.

## 2026-11-14 — Community model reference prices and usage records

- **What:** Admins publish revisioned model reference rates from Models. The gateway snapshots rates before dispatch, observes JSON/SSE token usage and stores exact reference points; Usage shows team records to admins and only personal records to members. Unpriced and interrupted calls stay explicitly unpriced/pending. Referenced presets use their model's rates. Public schemas/migrations cover SQLite, Postgres and MySQL. Console routes load on demand to keep new administration forms out of the initial bundle.
- **Upgrade:** The binary applies the new public migrations. Set model rates to value future calls; existing calls are not repriced. This slice records usage and does not yet enforce budgets or charge money.
- **Refs:** `docs/adr/0021-community-usage-and-budgets.md`, `docs/adr/0022-reference-usage-accounting.md`, `docs/tech/usage-budgets.md`.

## 2026-11-14 — The Node server is gone; the Go binary is the only server

- **What:** `apps/web` (Next.js and Auth.js), `packages/db` (Prisma, PGlite and their migrations), the server half of `packages/shared` and the parity run are deleted. `packages/shared` keeps the languages and `matchLocale`, which `apps/console` now imports. `pnpm dev:setup` starts Postgres 16 and MySQL 8.4 for the Go suites and prints the four variables they read; `dev:shared`, `dev:web`, `build:web`, the `postinstall` and every `db:*` script but `db:drift` are gone, as are `railpack.json`, `DATABASE_URL` and `SHADOW_DATABASE_URL` in CI, and the PGlite test run. `CLAUDE.md`, the README, `docs/tech/architecture.md` and `docs/tech/community-edition.md` describe the Go server.
- **Why:** Phase 6 of `docs/tech/go-server.md`: the binary serves everything the Node server did (ADR 0014).
- **Breaking:** A local database made by Prisma or PGlite is not read by the binary; there is no move, as the plan decided. Contributors' `.env` files for `apps/web` and `packages/db` no longer do anything.
- **Upgrade:** `pnpm install`; `pnpm dev:setup` for the new dev stack, on volumes of its own, and export what it prints. The old stack's `pgdata` volume is no longer used: `docker volume rm dsh-teamwork-dev_pgdata`.
- **Refs:** `docs/tech/go-server.md`, `docs/adr/0014-one-go-binary.md`, `dev/docker-compose.yaml`.

## 2026-11-14 — The Go server reads PROVIDER_KEYS_SECRET as the Node server did

- **What:** `PROVIDER_KEYS_SECRET` is decoded like Node's `Buffer.from(s, 'base64')`: the standard and URL-safe alphabets, padding optional, whitespace ignored. It must still be 32 bytes.
- **Why:** A key the Node deployment held, copied onto the Go server, stopped it at start: the Go server read only padded standard base64.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/internal/config/config.go`.

## 2026-11-14 — The Go server has an extension point for a closed edition

- **What:** `server/app` runs the server, and `cmd/dsh-teamwork` only calls `app.Main`. `server/edition` is what a closed package registers from its `init`: its own migrations per dialect, applied after the open history and recorded in `schema_migrations` as `<name>:<version>` (a set missing the running dialect stops the start), its routes on the server's mux, and a `stop` the server calls on shutdown before the database closes. The host lends it the database, Bearer and session verification, the same-origin check and an accounts interface. `server/edition/editiontest` serves the real server with extensions mounted, on each reachable database, for closed tests. The language check admits locale files a Go package embeds (`server/**/messages/*.json`); CI and the pre-push hook run every Go module's `e2e` directory; the workspace globs include `premium/server`. The community binary registers nothing.
- **Why:** Phase 5 of `docs/tech/go-server.md`: the closed edition is the same binary with closed packages compiled in (ADR 0014).
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `server/app/`, `server/edition/`, `server/internal/db/migrate.go`, `docs/tech/go-server.md`.

## 2026-11-14 — Self-hosting runs the Go server: npx, release binaries and the image

- **What:** `compose.yaml` runs one container built from `server/Dockerfile` (the console embedded, a static binary on distroless), with the SQLite file and the generated secrets in a volume and no `.env` required; Postgres is no longer part of it, and `DATABASE_URL` in a `.env` beside it points the server at Postgres or MySQL instead. `apps/web/Dockerfile` is gone. A tag `v<version>` runs `.github/workflows/release.yaml`, which publishes `@dsh-teamwork/server` and its five platform packages to npm (`npx @dsh-teamwork/server`), the five binaries with `SHA256SUMS` on a GitHub release, and `ghcr.io/dsh-teamwork/server` for amd64 and arm64. CI also runs the Go suites on SQLite, Postgres 16 and MySQL 8.4, the Go drift check per dialect, the DSH plugin's end-to-end test, and the packed release through `npx` on Linux, macOS and Windows; `server/` is a workspace package, so the gate needs Go.
- **Why:** Phase 4 of `docs/tech/go-server.md`.
- **Breaking:** A self-hosted instance on the old `compose.yaml` keeps its data in the Postgres volume, which the new file no longer starts. Nothing has been released before this, so no instance is known to exist.
- **Upgrade:** Contributors install Go (`server/go.mod`). The repository needs an `NPM_TOKEN` secret, with publish rights to the `@dsh-teamwork` scope, before the first tag.
- **Refs:** `server/Dockerfile`, `server/scripts/pack.mjs`, `server/npm/launcher.js`, `.github/workflows/ci.yaml`, `.github/workflows/release.yaml`, `README.md` ("Self-hosting").

## 2026-11-14 — The Go server serves the whole API, and the console beside it

- **What:** `server/` is the Go binary of ADR 0014, with `apps/console`, a Vite and React console built into it. It serves every route of `apps/web`'s API, described in `api/openapi.yaml`, on SQLite, Postgres or MySQL: the first account's setup link, password sign-in, emailed codes over SMTP, Google (through `github.com/markbates/goth`, at Auth.js's callback path `/api/auth/callback/google`), `/plugin` and the token exchange, teams, members, invitations, configurations, providers, the model catalogue, the profile, `GET /api/configs` and the model gateway, with server analytics to PostHog. An account is no longer its email: an `identities` table records each door, and a Google sign-in with a verified email joins the account that address has. The console has every page of the Next app: sign-in, the teams list and each team's overview, models, presets, plugins and members, and the account with the language picker (`POST /api/locale`). The home page and the legal pages are prerendered at the console's build, home in each language and sign-in state, privacy and terms from `LEGAL_DIR` as before; the binary fills in `APP_URL` where they name the site, and serves `robots.txt`, `sitemap.xml`, the share card and the www/apex redirect. Not deployed: the Node server still serves every instance.
- **Why:** Phases 1 to 3 of `docs/tech/go-server.md`.
- **Breaking:** None. Nothing runs the binary yet.
- **Upgrade:** Nothing. For the binary, when it is deployed: `DATABASE_URL` also takes `mysql://` and `sqlite:///path`, and with none the database is SQLite in the data directory (`--data`, default `~/.dsh-teamwork`), which also holds `secrets.json`, written on first start; `HOST` and `--host` choose the address, loopback by default; `AUTH_SECRET` must be at least 32 characters; `AUTH_EMAIL_FROM`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` keep their meaning; analytics, the server's and the browser's, read `POSTHOG_KEY` and `POSTHOG_HOST` at run time in place of `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`; `LEGAL_DIR` is read when the console is built (`pnpm --filter @dsh-teamwork/console build`), and `APP_URL` only at run time.
- **Refs:** `docs/adr/0014-one-go-binary.md`, `docs/tech/go-server.md`, `server/`, `apps/console/`, `api/openapi.yaml`.

## 2026-11-13 — The team console gets a sidebar and a page per task

- **What:** `/teams/{teamId}` is a console with a sidebar: a team switcher (every team the person is in, with their role; switching keeps the page), one link per page, and the account. `/teams` groups the person's teams into those they manage and those they joined. Members have their own page, `/teams/{teamId}/members`, as a table with invitations or account creation beside it; a member leaves the team from there. Models have their own page, `/teams/{teamId}/models`: an admin picks a provider from a list of nine OpenAI-compatible ones (DeepSeek, OpenAI, Qwen, Kimi, Zhipu GLM, Doubao, MiniMax, SiliconFlow, OpenRouter), pastes only its key, reads its model list and publishes several models at once; any other provider is entered by address. Each team model shows which presets use it, and a model or plugin a preset still uses cannot be removed (`409 model_in_use`, `plugin_in_use`). Presets have their own page, `/teams/{teamId}/presets`: an admin starts one from three persona templates (writer, data analyst, research analyst) or from nothing, and edits it in three tabs (basics; DSH tools, each required, optional or off, and plugins; persona and method). Plugins have their own page, `/teams/{teamId}/plugins`. `GET /api/teams/{teamId}/model-catalog` now requires `?provider=`. The overview, `/teams/{teamId}`, counts the team's models, presets, plugins and members, gives an admin a four-step setup checklist and members the command to connect DSH, and lists the latest configuration changes.
- **Why:** The single long `/team` page mixed every task; each task now has a page.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `apps/web/src/components/team/console-shell.tsx`, `apps/web/src/app/teams/[teamId]/layout.tsx`, `apps/web/src/lib/provider-catalog.ts`, `apps/web/src/lib/preset-templates.ts`.

## 2026-11-13 — A person may be in several teams

- **What:** A membership is keyed by user and team, so one account can be in any number of teams, admin in some and member in others. The console moves from `/team` to `/teams` (the list, create, join) and `/teams/{teamId}`; the API from `/api/team/*` to `/api/teams/{teamId}/*`, where a team the caller is not in is `404 team_not_found`. The plugin's snapshot moves to `GET /api/configs` and lists every team: `{ teams: [{ teamId, teamName, role, configs }] }`. The gateway resolves a model to its own team and calls that team's provider. Invitation links are `/teams?invite=…`; `no_team` is gone. An admin cannot reset the password of a member who is also in another team (`member_in_other_team`).
- **Why:** One person working for more than one team needed one account per team. ADR 0013.
- **Breaking:** Plugin 0.6 cannot read the new snapshot and stops syncing until upgraded to 0.7.0. Links to `/team` and `/team?invite=…` answer 404. Any script calling `/api/team/*` moves to `/api/teams/{teamId}/*`.
- **Upgrade:** `pnpm db:deploy` (migration `memberships_per_team`: the key becomes `(user_id, team_id)`; existing rows are unaffected). Publish plugin 0.7.0 the same day as this server.
- **Refs:** `docs/adr/0013-one-person-many-teams.md`, `apps/web/src/lib/team.ts`, `apps/web/src/lib/llm-gateway.ts`, `packages/shared/src/team.ts`.

## 2026-11-13 — The DSH plugin gets its sign-in code back on loopback

- **What:** `/plugin` also accepts a `redirect_uri` of `http://127.0.0.1:<port>/…`, on every deployment and with no configuration. Pressing Authorize sends the browser there with `?code=…`, and the `/teamwork authorize <code>` line stays on screen in case it does not arrive. `localhost`, `[::1]`, https and a missing port are refused, and still make the link invalid.
- **Why:** The first sign-in no longer has a copy-and-paste step. The plugin listens on that address from `/teamwork login` (plugin 0.6.0). ADR 0012.
- **Breaking:** Plugin 0.6.0 sends `redirect_uri` on every login, and a server without this change shows its link as invalid. Upgrade the server with the plugin.
- **Upgrade:** Nothing.
- **Refs:** `docs/adr/0012-the-plugin-gets-its-code-back-on-loopback.md`, `packages/shared/src/server/auth/nextauth/plugin.ts`, `apps/web/src/components/plugin-authorize.tsx`.

## 2026-11-13 — A phone app gets its sign-in code back by redirect

- **What:** `/plugin` takes an optional `redirect_uri`. When it starts with the new `MOBILE_REDIRECT_URI`, pressing Authorize sends the browser to `redirect_uri?code=…` instead of showing the code for pasting, and the code stays on screen in case the app does not open. A `redirect_uri` outside the prefix makes the link invalid. With the variable unset, no code is sent anywhere.
- **Why:** The phone app no longer has to paste a long code. ADR 0010.
- **Breaking:** None.
- **Upgrade:** Optional `MOBILE_REDIRECT_URI` on `web`; the hosted service sets `dshteamwork://sign-in`. Self-hosted instances leave it unset.
- **Refs:** `docs/adr/0010-the-app-gets-its-code-back.md`, `packages/shared/src/server/auth/nextauth/plugin.ts`, `apps/web/src/app/plugin/page.tsx`.

## 2026-11-13 — Auth.js takes its origin from APP_URL

- **What:** With `AUTH_URL` unset, `createNextAuth` sets it from `APP_URL`, so Auth.js builds its OAuth callback from the deployment's public origin instead of the request. `AUTH_URL` leaves `apps/web/.env.example`; one still set wins.
- **Why:** Behind Railway's proxy the request names the container (`localhost:8080`), so Google refused the token exchange with `redirect_uri_mismatch` and the browser landed on `https://localhost:8080/sign-in?error=Configuration`.
- **Breaking:** None.
- **Upgrade:** Set `APP_URL` to the public origin; `AUTH_URL` can be dropped where it equals it.
- **Refs:** `packages/shared/src/server/auth/nextauth/index.ts`.

## 2026-11-12 — The www twin redirects to APP_URL; APP_URL reaches the build

- **What:** In production, the `www`/apex twin of the deployment's origin (`AUTH_URL`, else `APP_URL`) answers a 308 to that origin, path and query kept (`apps/web/canonical-host.mjs`, compiled into the build's redirects). `turbo.json` now passes `APP_URL` and `AUTH_URL` to `@dsh-teamwork/web#build`: strict env mode had stripped them, so the static `robots.txt`, sitemap and canonicals named `http://localhost:3800`.
- **Why:** Auth.js cookies are host-only and Google returns to one callback, so signing in on the twin host failed. The hosted service serves `dshteamwork.com` and `www.dshteamwork.com`.
- **Breaking:** None.
- **Upgrade:** Set `APP_URL` where the web app is built, not only where it runs (on Railway the service variable already is; `compose.yaml` now passes it as a build argument). Redeploy, or `docker compose up --build`.
- **Refs:** `apps/web/canonical-host.mjs`, `turbo.json`; router9's `apps/web/canonical-host.mjs`.

## 2026-11-12 — The web app is the home page; legal pages from LEGAL_DIR

- **What:** The web app's `/` is now the landing page on every instance (what DSH Teamwork is, as a project and a service, and the way in), with its share card and JSON-LD; the start page is gone. `/privacy` and `/terms` are rendered at build from the Markdown in `LEGAL_DIR`, a deployment's own directory; unset, the routes answer 404 and the footer and sitemap leave them out. `next.config` inlines `LEGAL_DIR`, so links follow the build, and `turbo.json` passes it to `@dsh-teamwork/web#build` with any `docs/legal/*.md` in the cache key (strict env mode had stripped it). `react-markdown` and `remark-gfm` join the web app.
- **Why:** ADR 0007: the hosted service drops its separate landing site and `alpha.` subdomain and serves the web app on `dshteamwork.com`, which is also the DSH plugin's default server.
- **Breaking:** A self-hosted instance's `/` changes from the start page to the landing page. Browsers on the hosted service sign in again once its origin moves.
- **Upgrade:** Optional `LEGAL_DIR` at build. The hosted service sets `LEGAL_DIR=premium/docs/legal` and `APP_URL=https://dshteamwork.com` on `web`, and adds Google's OAuth callback for the root domain.
- **Refs:** `docs/adr/0007-one-domain-one-app.md`, `apps/web/src/lib/legal.ts`, `docs/tech/community-edition.md`.

## 2026-11-12 — The plugin's snapshot names the team and the caller's role

- **What:** `GET /api/team/configs` answers `{ teamId, teamName, role, configs }`: the team's name and whether the caller is its `admin` or a `member`, beside the configurations. The plugin's new DSH sidebar panel shows both, and links an admin to `/team`.
- **Why:** The Teamwork panel in DSH names the team a member is in and offers admins the way to the console, without a second request.
- **Breaking:** A plugin that parses the snapshot strictly must accept the two fields; the plugin build released with the panel does.
- **Upgrade:** Nothing.
- **Refs:** `packages/shared/src/team.ts`, `apps/web/src/lib/team.ts`, `docs/tech/architecture.md`.

## 2026-11-12 — The DSH command is /teamwork

- **What:** The plugin's command is `/teamwork` instead of `/team` (`/teamwork login`, `/teamwork authorize <code>`, `/teamwork sync`, …). The plugin sign-in page shows `/teamwork authorize <code>` to paste back, and the web app's copy and these documents name the new command. The web console stays at `/team`.
- **Why:** The developer's call: `/teamwork` names the product, and leaves `/team` to DSH's own team features.
- **Breaking:** A member on a plugin build from before this change types `/team`; the pages now show `/teamwork`. Update the plugin.
- **Upgrade:** Update `@dsh-teamwork/dsh-teamwork`.
- **Refs:** `dsh-teamwork/dsh-teamwork` ac2fe24.

## 2026-11-11 — Providers belong to teams

- **What:**
  - A team's admin adds its model providers in `/team`: a name, an OpenAI-compatible base URL and a key. They are stored in a new `team_providers` table, the key sealed with AES-256-GCM under `PROVIDER_KEYS_SECRET`, write-only.
  - The gateway calls the caller's team's provider. A team model must name one, and a provider in use cannot be removed.
  - `LLM_ROUTES_JSON` and its key variables are removed.
  - New `ALLOW_PRIVATE_PROVIDERS`: without it, only public https addresses; with it, loopback and private networks too, plain http only there. It is checked on save, before each call, and in the connection's own DNS lookup.
  - New routes: `GET`/`POST /api/team/providers` and `PUT`/`DELETE /api/team/providers/:id`.
  - New exact dependency: `undici` 7.30.1.
- **Why:** ADR 0006, Phase 4 step 4 of `docs/tech/community-edition.md`. A team brings its own keys, and an instance needs no operator to write provider routes.
- **Breaking:**
  - Every deployment: team models stop answering (`provider_not_configured`) until the team's admin adds a provider of the same name.
  - The hosted service becomes bring-your-own-key.
  - A self-hosted instance calling a private-network model needs `ALLOW_PRIVATE_PROVIDERS=true`, which `compose.yaml` now sets.
- **Upgrade:**
  - Migration `20261111145658_team_providers`.
  - Set `PROVIDER_KEYS_SECRET` (`openssl rand -base64 32`) and drop `LLM_ROUTES_JSON` and its key variables.
  - Each team's admin adds its providers in `/team`.
- **Refs:** ADR 0006, `apps/web/src/lib/provider-network.ts`, `apps/web/src/lib/provider-keys.ts`.

## 2026-11-11 — Passwords when SMTP_URL is unset

- **What:**
  - Without `SMTP_URL`, sign-in is an email and a password instead of an emailed code. Passwords are kept as scrypt in a new `passwords` table, with ten guesses per account per fifteen minutes.
  - The server prints a link at start that claims the first account.
  - A team admin creates members with a first password, shown once, which they must change before `/team` or `/plugin` open, and resets it the same way.
  - New routes: `POST /api/team/members` and `POST /api/team/members/:userId/password`.
  - A session's `via` can be `password`; the console refuses it.
  - The development fallback that printed a code to the console without SMTP is gone.
- **Why:** ADR 0006, Phase 4 step 3 of `docs/tech/community-edition.md`: an instance with no mail server still has a way in.
- **Breaking:** A development server without `SMTP_URL` now asks for a password instead of printing a code.
- **Upgrade:** Migration `20261111143836_passwords` (`pnpm db:deploy`, or automatic on PGlite). An instance with `SMTP_URL` set needs nothing else.
- **Refs:** ADR 0006, `packages/shared/src/server/auth/nextauth/passwords.ts`.

## 2026-11-11 — PGlite when DATABASE_URL is unset

- **What:** Without `DATABASE_URL`, the apps run on PGlite, an in-process Postgres. Its data directory is `PGLITE_DIR` (default `~/.dsh-teamwork/db`). It applies the committed migrations on first connect and records them as Prisma does. The suites that needed Postgres now always run, on PGlite in memory, and CI runs them on both databases. The apps no longer fall back to the `pnpm dev:setup` stack; the Prisma CLI still does. New exact dependencies: `@electric-sql/pglite` 0.5.16 and `pglite-prisma-adapter` 0.7.2.
- **Why:** ADR 0006: the community edition runs from one command; Phase 4 step 2 of `docs/tech/community-edition.md`.
- **Breaking:** A process started with no `DATABASE_URL` now opens a PGlite directory instead of connecting to `localhost:5432`.
- **Upgrade:** `pnpm install`. Keep `DATABASE_URL` set (as `apps/web/.env.example` does) to stay on Postgres.
- **Refs:** ADR 0006, `packages/db/src/pglite.ts`.

## 2026-11-11 — The community edition is public

- **What:** This repository, `dsh-teamwork/dsh-teamwork-platform`, is the community edition's own home and the upstream of the closed edition. Open changes are made here and merged there. The pre-push hook and CI also run the edition boundary check wherever the closed edition's script exists, which is never in this repository.
- **Why:** ADR 0005; Phase 3 of `docs/tech/community-edition.md`.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/tech/community-edition.md`.

## 2026-11-11 — Apache-2.0, and CI on pull requests

- **What:** The repository is licensed Apache-2.0 (`LICENSE`), with a `NOTICE` keeping the name and the whale mark out of the licence, and a README section asking for a `Signed-off-by:` line on every commit (the DCO). CI runs on every pull request as well as on `main`, and a `self-host` job builds `apps/web/Dockerfile`, starts `compose.yaml` and checks the web app answers. The root `dev:manage` script is gone.
- **Why:** The community edition is about to be published (ADR 0005, `docs/tech/community-edition.md`).
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `README.md`, `NOTICE`, `.github/workflows/ci.yaml`.

## 2026-11-10 — The web app's home page becomes a start page

- **What:** `/` in `apps/web` is a short start page: the logo, the name and tagline, and one way in (sign in, or open your team). The landing page, the share card, the JSON-LD, `/privacy`, `/terms` and their build step (`pull-legal.mjs`) are no longer part of the web app, which drops `react-markdown` and `remark-gfm`. The language check exempts every app's `messages/`; the root `CLAUDE.md` copies seed's lint-docs and Documentation section (a second documentation tree; legal pages only where published).
- **Why:** A self-hosted instance needs a way in, not the hosted service's landing page or its legal pages, which name Shushuo as the controller (`docs/tech/community-edition.md`).
- **Breaking:** `/privacy` and `/terms` are gone from the web app's origin.
- **Upgrade:** Nothing.
- **Refs:** `docs/tech/community-edition.md`, `docs/design.md`.

## 2026-11-10 — The schema moves to a folder; the icon script finds every app

- **What:** The Prisma schema is `packages/db/prisma/schema/schema.prisma`, a folder other `.prisma` files can join; the generator's output, `prisma.config.ts`, the drift script and turbo's input follow it. `pnpm-workspace.yaml` also matches `premium/apps/*` and `premium/packages/*`, which match nothing in the community edition. `generate-icons.mjs` exports for every app it finds instead of a fixed list, so every app gets the same tab, home-screen and logo files.
- **Why:** The community edition split (`docs/tech/community-edition.md`): the open schema and scripts must name nothing they cannot find.
- **Breaking:** None.
- **Upgrade:** `pnpm install`.
- **Refs:** `docs/tech/community-edition.md`.

## 2026-11-10 — The web app can be self-hosted

- **What:**
  - Sign-in codes go over SMTP (`SMTP_URL`, sent with nodemailer) instead of Resend's HTTP API.
  - The Google provider and its button exist only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.
  - The gateway accepts a plain `http://` provider only when its host resolves to loopback or private addresses.
  - `apps/web/Dockerfile` and `compose.yaml` run Postgres and the web app, and the README's self-hosting section explains them.
- **Why:** The community edition must run without Shushuo's services (ADR 0005, `docs/tech/community-edition.md`), including against a model the team serves itself.
- **Breaking:** `RESEND_API_KEY` is no longer read: a deployment sends no sign-in code until it has `SMTP_URL`.
- **Upgrade:** Set `SMTP_URL` (any SMTP server; Resend's is `smtps://resend:<API key>@smtp.resend.com:465`) and drop `RESEND_API_KEY`. Locally, leave it unset to have codes printed.
- **Refs:** `docs/tech/community-edition.md`, `README.md`.

## 2026-11-10 — The product gets its mark and palette

- **What:** `docs/brand/icon.svg` is the whale mark: a paper fluke tilted into a calm sea on an indigo plate (`#1E2F6D`). Both apps' token scales move from seed's greyscale to the brand's: warm paper grounds and indigo ink in light, indigo-black in dark, `--brand` indigo. The in-app logo keeps its plate with rounded corners, so each app has one `public/logo.svg` for both themes; `logo-dark.svg` is gone and `scripts/generate-icons.mjs` exports the logos that way. The share card shows the logo beside the name and tagline, on paper, set in Onest, whose two latin `.woff` files and OFL licence live in `apps/web/assets/fonts`.
- **Why:** The product had seed's placeholder mark and greyscale scale; this is the identity chosen for it.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md`.

## 2026-11-10 — The platform is rebuilt from seed

- **What:** The repository starts again from `~/code/shushuo/seed` at `3f2e262` (`pnpm rename dsh-teamwork 38 --auth nextauth`): Next.js 16 / React 19, Prisma 7 in `packages/db`, Zod 4, Turborepo, the husky gate and seed's docs layout. The MVP's rules are ported onto it: teams, single-use invitations, team configuration (models, presets, plugin pins) with optimistic versions, and the model gateway. The API moved from `/api/v1/*` to one route per resource under `/api/*`, answering `{ error: <code> }` with `TEAM_ERRORS`. Sign-in is Google or an emailed code; the plugin signs in through `/plugin` and `POST /api/auth/plugin/token` with a stateless 30-day token. `apps/api`, `apps/bot-lark`, `website/`, `infra/`, `packages/core`, the mobile app, the store pipeline and `packages/s3` are gone. Local Postgres comes from this repository's `dev/` (`pnpm dev:setup`) or from the shared `~/code/shushuo/dev` stack (`pnpm dev:shared`), with the same database names in both.
- **Why:** Every Shushuo product shares seed's stack, gate and deployment; the MVP had drifted from all three and could not be deployed safely (its only sign-in was a fixed development code).
- **Breaking:** The plugin's API paths, its sign-in exchange and the error shape. `@dsh-teamwork/dsh-teamwork` changes in step; nothing was deployed.
- **Upgrade:** `pnpm install`, `pnpm dev:setup` (or `pnpm dev:shared`), copy each `.env.example`, `pnpm db:deploy`. New variables: `AUTH_SECRET`, `AUTH_GOOGLE_*`, `RESEND_API_KEY`, `LLM_ROUTES_JSON` and the keys it names. Removed: `NEXTAUTH_*`, `DEV_FIXED_OTP*`.
- **Refs:** `docs/adr/0001-plugin-sign-in.md`, `docs/adr/0002-platform-from-seed.md`, `docs/tech/architecture.md`.

## Before 2026-11-10

The MVP (`60d681c`…`4f83905`): a Next.js 15 app with a fixed development OTP
and a hand-written SQL migration runner, which nothing deployed. Its tables
are not carried over; the migration history starts with seed's.
