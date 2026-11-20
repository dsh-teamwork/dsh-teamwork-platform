# 0060. A plugin's or the app's token names a revocable grant

> **Status:** Accepted · **Date:** 2026-11-20

## Context

ADR 0001 made the Bearer token the DSH plugin and the phone app hold a
stateless 30-day JWE that nothing can revoke. The plugin made that tolerable by
keeping the token in memory only, so every restart of DSH asked its member to
sign in again, and a computer that was not signed in was also offline to the
relay, the phone and the console. Members restart DSH every day; signing in
each time is the plugin's most common annoyance.

Keeping the token on disk fixes that, but a file can be copied. A copied
stateless token is a credential nobody can take back for 30 days, and renewing
it on use, which a DSH in daily use needs so that it never has to sign in
again, would make that forever.

## Decision

**Every plugin and app sign-in records a row in `plugin_grants`, and the token
names that row.**

- `POST /api/auth/plugin/token` creates the grant (`user_id`, `via`,
  `used_at`) and seals its id into the token. A token opens only while its
  grant exists, `used_at` is within `auth.GrantIdle` (30 days), and its seal
  is within `auth.GrantMaxTTL` (a year from sign-in).
- **Use renews it.** Every request that opens the token moves `used_at` on, at
  most once an hour, by a conditional update. The token itself never changes,
  so a client renews nothing; `expiresAt` in the exchange's answer is when it
  lapses if unused.
- **`DELETE /api/auth/plugin/token`** deletes the grant the Bearer sent names:
  signing out of the plugin or the app revokes that token everywhere, and only
  it. Deleting an account deletes its grants.
- Every place a Bearer opens goes through `auth.Service.OpenBearer`
  (`requireUser`, `requirePlugin`, and `BearerIdentity`, which the relay and
  an edition call), so a revoked or lapsed grant is refused on the next
  request and drops an open relay socket at its next ping.
- The plugin keeps the token beside its cache, readable by its user alone,
  with the server it belongs to, and restores it at start.
- **A computer knows its sign-in.** Each relay hello records the grant it
  came with on the computer's `relay_hosts` row (`grant_id`). Removing the
  computer in the console (`DELETE /relay/hosts/{id}`) deletes that grant in
  the same transaction and closes its socket, so a lost computer is signed out
  from any browser, connected or not.

Browser sessions, computer tokens (ADR 0038) and host tokens (ADR 0047) are
unchanged: a session is not kept by a client outside the browser, and the other
two live an hour and are renewed by their host.

## Consequences

- Restarting DSH keeps its member signed in and its computer online; a DSH
  used at least once a month never signs in again within the year.
- One more read per Bearer request, beside the membership read every team rule
  already makes, and at most one write per grant per hour.
- A copied token file still works until its grant is revoked or lapses: the
  member signs out on that computer, or removes it in the console. A copy
  used from another machine with another `clientId` shows there as a computer
  of its own, removable the same way. The phone app's grants are listed
  nowhere yet; signing out of the app revokes its grant once the app sends
  the same `DELETE`, and until then it lapses unused.
- Every token minted before this decision carries no grant and opens nothing:
  each plugin and app signs in once more. Nothing had shipped that depended on
  them.
- This supersedes ADR 0001's "a plugin token cannot be revoked before it
  expires" and its 30-day fixed lifetime; its PKCE hand-off is unchanged.
