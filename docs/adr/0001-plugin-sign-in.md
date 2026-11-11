# 0001. The DSH plugin signs in through the website with a pasted PKCE code

> **Status:** Accepted · **Date:** 2026-11-10

## Context

The DSH plugin runs inside a DSH host that cannot receive a browser redirect,
and it needs a credential the web API accepts. The first MVP minted random
tokens and stored their hashes in a `plugin_sessions` table, with its own
authorization-code table beside it. Seed's NextAuth strategy already has a
stateless PKCE hand-off for a client outside the browser (built for a phone,
which receives a redirect to its URL scheme).

## Decision

Reuse seed's hand-off and drop both tables. The plugin opens
`/plugin?challenge=…`; a signed-in person presses Authorize (a server action),
is shown a two-minute code — a JWE under `AUTH_SECRET` bound to the challenge —
and pastes it into DSH. The plugin redeems code + verifier at
`POST /api/auth/plugin/token` for a 30-day JWE Bearer token with its own salt.

## Consequences

- No session table and nothing to clean up; the web session and the plugin
  token are verified the same way.
- **A plugin token cannot be revoked before it expires.** Signing out of the
  plugin forgets the token locally only. What still revokes access is the
  membership, re-read on every request: a removed member is refused at once.
  Rotating `AUTH_SECRET` signs out every plugin and browser.
- The code is shown on screen rather than redirected, so it is only as secret
  as that screen; the verifier, which never leaves the plugin, is what makes a
  seen code useless to anyone else.
- A per-device token list ("sign out that laptop") would need a table again;
  that is a new decision, not a flag on this one.
