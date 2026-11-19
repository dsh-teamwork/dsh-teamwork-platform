# 0053. Pages are served sandboxed, from an origin of their own, to the team alone

> **Status:** Accepted · **Date:** 2026-11-19

## Context

A page is HTML an agent wrote, with scripts (ADR 0052). Served from the
console's own origin as an ordinary page, its scripts could read what the
console keeps, call the API as whoever opened it, or pass for the console in
the address bar. Claude and other products serve such content from a domain of
its own; a self-hosted server has one domain. Public links were wanted at
first, and set aside: a team's work stays the team's, and content for the open
internet needs a way to take down what is abused.

## Decision

**Every page is served under `/p/{token}/` with a CSP sandbox that never
admits `allow-same-origin`, from `CONTENT_URL` when set, to signed-in members
of its team whom its sharing admits, re-checked on every request.**

- **The address is a capability, not a session**: a token of its own purpose
  (`auth.PageView`) for one reader, one version, one hour. No cookie is set or
  read; relative paths resolve under it.
- **Every response under `/p/`** carries the sandbox and a policy admitting
  only the page's own files, inline script and style and three CDNs,
  `frame-ancestors` limited to `APP_URL`, `nosniff`, `no-referrer`, `noindex`
  and `private, no-cache` with an ETag (`internal/pages/view.go`, `Headers`).
- **`CONTENT_URL`** is the origin `/p/` is served from; unset, it is
  `APP_URL`'s. It must be another registrable domain: a subdomain shares the
  site the console's cookies go to, and the server refuses to start on one.
  Where it is set, its host serves `/p/` and a crawler-refusing `robots.txt`
  only, and `APP_URL`'s host serves no page. The hosted service uses
  `dshteam.work`.
- **No page leaves its team, in any edition**: no public link, no guest link,
  no copy to another team.

## Consequences

- In Chromium, a framed or opened page has a `null` origin, cannot touch
  cookies, storage or IndexedDB, has no service worker, and its requests to
  the API are refused by the policy before they leave (step 0 of
  `docs/tech/pages.md`). Safari, Firefox and the phones' WebViews are checked
  on devices before the phone app shows pages.
- A self-hosted server is safe on one domain; a hosted one adds a second site
  as defence in depth. The domain is in every open view address, so it stays
  registered while the service runs.
- Revocation is immediate, at the price of one indexed query per file served.
- Ruled out: pages on the console's origin without a sandbox, a subdomain of
  `APP_URL` as the content origin, and public or guest links.
