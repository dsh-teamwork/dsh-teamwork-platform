# 0041. An edition composes the web app, and development serves it through Go

> **Status:** Accepted · **Date:** 2026-11-17

## Context

The closed edition already extends the server by composition: its module
imports the open one and registers through `server/edition`. Its operator
console does the same with `mountAdmin` from `@dsh-teamwork/manage`. Its
member-facing pages did not: billing was a second single-page app at
`/billing/teams/{id}`, linked from the open console through
`Host.AddTeamPage` (ADR 0028), drawing its own header and reaching into
`apps/web/src` by relative path for the stylesheet. Every closed user page
the governed direction adds (ADR 0003: SSO, roles, audit), and a hosted
landing page or `/pricing`, would have repeated that.

Development had the same seam in the wrong place. The browser opened a Vite
server, which proxied `/api` to the Go server on another port and re-implemented
the public pages' routing; the management console needed `APP_URL` pointed at
its own port, so the web app and the console could not be worked on at once.

## Decision

**An edition's web app composes the open one, as its server and its operator
console do.** `apps/web` exports `mountWeb` (`@dsh-teamwork/web/app`), which
takes the routes and team pages an edition adds; one at the path of an open
page replaces that page. Public pages are not routes: they are files the
build prerenders (`home.{locale}[.signed-in].html`, `docs.{slug}.{locale}.html`,
and `{name}.{locale}.html` or `{name}.html` for `/{name}`), so an edition adds
or replaces one in its own `src/public/render.tsx`, and the server serves
whatever its build holds by those names. `Host.SetWebConsole` hands the
server the edition's build in place of the embedded open one. Editions do not
change open pages; they add pages and replace whole paths.

**In development the Go server is the one address, :3800, as in production.**
`pnpm dev` starts the edition's Go server with `DEV_VITE=1`, the edition's web
Vite on :3810 and the management console's on :3811. Go takes the console's
index, its modules and the public pages (rendered on request by
`apps/web/scripts/vite-pages.mjs`) from those servers, and decides which page
answers which path exactly as it does over a build. Hot updates connect to the
Vite servers directly.

`Host.AddTeamPage` and the session's `teamPages` are removed.

## Consequences

- One origin in development: the API, the session, `APP_URL` and OAuth
  callbacks are the production shape, and the web app and the management
  console run together. The public pages' routing exists once, in Go.
- A closed page is a route in the closed web app, inside the open console's
  shell and its team navigation; no second app, header or stylesheet.
- The closed binary embeds its own web build, so the hosted image builds the
  edition's web app instead of the open one.
- What an edition can change is fixed by `mountWeb`'s parameters and the page
  file names. Changing an open page's content is a change to the open page.
- `DEV_VITE` is a development switch the binary reads; set in production, it
  breaks the pages rather than opening anything, since its addresses are
  fixed to localhost.
- Supersedes ADR 0028.
