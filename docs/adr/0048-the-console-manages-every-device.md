# 0048. The web console manages every device paired with a member's own computers

> **Status:** Accepted · **Date:** 2026-11-18

## Context

A member reaches their own computers from the phone app and, with My DSH
([relay.md](../tech/relay.md), "My DSH in the web console"), from the browser.
The hosted edition's ADR 0020 made relay admission belong to a handset within
an account: one handset can neither list nor revoke another's pairings, so a
second phone signed in to the same account cannot cut the first one off. That
left a lost phone revocable only from the desktop's Teamwork panel, which the
member may not be at, and gave the browser no view of which devices reach
their computers.

## Decision

**The web console, by the member's session cookie, lists the member's own
computers with every live pairing of theirs to them, and revokes any of those
pairings.**

- **`GET /relay/hosts`** answers the session cookie alone; an app's Bearer is
  refused. Each computer comes with its name, DSH version, whether its socket
  is open and when it was last seen, and each pairing with its device name,
  status, last use, whether it pushes, and whether it is this browser's.
- **`DELETE /relay/pairings/{id}` without a Bearer** revokes any pairing of
  the member to a computer they own, as a write from this site only. With a
  Bearer it keeps to the app's own handset, as ADR 0020 says.
- **Reach, not identity.** The console still cannot attach as another device,
  read for it or act as it: a socket and every frame stay bound to the
  handset credential and to the keys both ends pinned. Revoking another
  device's pairing goes through the relay alone, as for an offline desktop;
  the desktop drops that device's trust the next time it lists its pairings.
- **Own computers only.** Pairings to a team's shared DSH, and every other
  member's, stay out of reach.

## Consequences

- A member cuts off a lost phone from any browser, and sees which devices
  reach each computer.
- Whoever holds the member's web session can see their devices' names and
  disconnect them. That session can already change the member's teams, so the
  loss is availability, not secrecy: it reads nothing and drives nothing.
- This loosens ADR 0020 for the console only; the app's token, the socket and
  pairing redemption keep its handset rule.
