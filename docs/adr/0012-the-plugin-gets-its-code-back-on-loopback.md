# 0012. The DSH plugin gets its sign-in code back on a loopback address

> **Status:** Accepted · **Date:** 2026-11-13

## Context

ADR 0001 has the plugin's sign-in code shown on `/plugin` and pasted back into
DSH, on the premise that a DSH host cannot receive a redirect. The host cannot,
but the plugin can: it is a Node process, and nothing stops it from listening
on a local port for as long as a sign-in is open. Pasting was the one step of
the first sign-in that went wrong in practice. The page showed a command line,
while the panel asked for a short code the server never issues. ADR 0010
already lets a phone app take its code back by redirect, after the same
confirmation.

## Decision

`/plugin` accepts a `redirect_uri` of `http://127.0.0.1:<port>/…` (RFC 8252
§7.3: plain http, the IPv4 loopback literal, an explicit port) and sends the
browser there with `?code=…` after the person presses Authorize, as it does for
the app. This needs no configuration and is accepted on every deployment. The
plugin listens on a port the system picks, on 127.0.0.1 only, from
`/teamwork login` until a code redeems or ten minutes pass. The page keeps the
`/teamwork authorize <code>` line on screen in case the redirect does not
arrive, and pasting still works everywhere.

## Consequences

- The first sign-in is: open the link, sign in, press Authorize. Nothing is
  copied.
- Any local process, or any web page making the browser request that address,
  can deliver a code to the listener. A code redeems only with the verifier
  this plugin holds, so a code from someone else's sign-in fails and cannot
  sign the plugin in to another account. A failed delivery leaves the listener
  open for the real one.
- A browser on another machine than DSH (DSH over SSH, in a container) cannot
  reach the listener. The redirect then fails in the browser, and the person
  pastes the line instead.
- `localhost` and `[::1]` are refused. One literal is one thing to check, and
  `localhost` can resolve somewhere else.
- A server that predates this decision treats the plugin's login link as
  invalid, so the plugin and the server ship together.
