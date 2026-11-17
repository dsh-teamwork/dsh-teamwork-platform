# 0040. The phone app deletes the account with its own token

> **Status:** Accepted · **Date:** 2026-11-17

## Context

ADR 0039 let an account be deleted from a browser session only, so that a
plugin token, which an agent on the member's computer can read, could not end
the account. The App Store (5.1.1(v)) requires an app that creates or signs in
to accounts to offer deletion inside the app. The phone app signs in through
the same hand-off as the plugin and holds the same kind of 30-day Bearer token
(ADR 0010); the server cannot tell the two apart, and sending the person to a
browser where they are not signed in is the redirect the guideline rules out.

## Decision

`DELETE /api/profile` takes a Bearer token as well as a session, with the same
confirmation: the account's email typed back. Everything else in ADR 0039
stands. A computer token (ADR 0038) still opens as nobody on this route, as on
every route but the configuration sync and the model gateway.

## Consequences

The phone app's Me tab can delete the account in place. A plugin token can
too, given the account's email: an agent that holds the member's token and
knows their address can end the account. That is no wider than what the token
already reaches (it can change every team the member administers), but it is
irreversible, so the confirmation stays mandatory and no client sends it
without the person typing it. A token that cannot delete the account would
need a second token kind for the app, which ADR 0010 chose not to have.
