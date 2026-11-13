# 0010. A phone app gets its sign-in code back by redirect, after the same confirmation

> **Status:** Accepted · **Date:** 2026-11-13

## Context

The plugin signs in with a code the person copies off `/plugin` and pastes back
(ADR 0001), because a DSH host cannot receive a redirect. A phone app signing
in the same way can: it opens the page in the system browser and owns a URL
scheme the browser hands back to. Pasting a long code on a phone is the one
awkward step left in its sign-in. Seed's mobile hand-off mints on a plain
`GET` and redirects at once; ADR 0001 chose that a link alone never mints a code.

## Decision

`/plugin?challenge=…&redirect_uri=…` accepts a `redirect_uri` only when it
starts with `MOBILE_REDIRECT_URI`, an address the deployment configures (the
hosted service: `dshteamwork://sign-in`). The person still signs in and presses
Authorize; the page then sends the browser to `redirect_uri?code=…` and keeps
the code on screen in case the app does not open. A `redirect_uri` outside the
prefix makes the link invalid. Unset, no code is sent anywhere and the page
behaves as before.

## Consequences

- Signing the app in is one tap on Authorize, with no copying.
- A link alone still mints nothing, and a code still redeems only with the
  verifier the app that started the sign-in holds.
- A custom URL scheme is not exclusive on Android: another app can claim it.
  Such an app receives only codes for sign-ins the real app started, which are
  useless without that app's verifier. A sign-in an attacker started is the
  case ADR 0001 already accepted for a pasted code: the person has to confirm
  a sign-in they did not begin.
- One prefix per deployment. A second app is a list, which is a new decision.
- Verified app links (an `https` address the app claims) would close the
  Android gap and need a file served from the site; they are not built.
