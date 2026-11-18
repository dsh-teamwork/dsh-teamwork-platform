# 0046. Every server sends the official app its sign-in code, at one fixed address

> **Status:** Accepted · **Date:** 2026-11-18

## Context

ADR 0010 let a phone app get its sign-in code back by redirect, after the
person confirms on `/plugin`, to an address a deployment configures in
`MOBILE_REDIRECT_URI`. Only the hosted service set it. ADR 0044 then made the
relay and shared DSHs part of the community edition and decided that the
official app reaches any server, which a self-hosted server could not serve
without first learning to set a variable whose only useful value is the
app's own scheme. The app also always sends exactly `dshteamwork://sign-in`,
while the server accepted anything starting with the configured prefix.

## Decision

- **The server accepts the phone app's address with no setting**:
  `redirect_uri` is either the plugin's loopback listener (ADR 0012) or
  exactly `dshteamwork://sign-in` (`wire.AppReturn`); anything else makes the
  link invalid. `MOBILE_REDIRECT_URI` is removed. The rest of ADR 0010 stands:
  the person signs in and presses Authorize, the code goes to the app and also
  stays on screen, and it redeems only with the verifier the app holds.
- **The app's release builds ask which server**, defaulting to the hosted
  service, and sign in to any https server, or to a loopback one over plain
  http (the plugin's address rule).

## Consequences

- A self-hosted server works with the official app as installed, with nothing
  to configure.
- A fork of the app under another scheme cannot sign in by redirect; its user
  pastes the code the page shows. Accepting a second scheme is a new decision.
- Exact matching closes look-alikes under the old prefix
  (`dshteamwork://sign-in.example`). Android does not reserve a scheme to one
  app, as ADR 0010 already accepted: another app that claims it receives only
  codes useless without the real app's verifier.
