# 0038. A computer token signs a cloud computer's DSH in for one team

> **Status:** Accepted · **Date:** 2026-11-17

## Context

An edition runs DSH with the teamwork plugin in cloud computers: VMs a
dispatcher makes and gives a token through the plugin's `tokenFile`. The
plugin needs a token to sync its team's configuration and to call team models
through the gateway. In a VM, the agent's commands run as the same user as
DSH, and DSH's sandbox limits what they write, not what they read: the agent
can read the token.

A member's plugin token (ADR 0001) lasts thirty days and reaches every route
the member may use, including an admin's writes and every team the member is
in. Handing it to a VM would let an agent that reads it act as the member,
anywhere, for a month.

## Decision

**A computer token is a sealed value of its own kind, for one member and one
team, accepted by two routes only.**

- **Its own purpose and key** (`auth.ComputerBearer`), so it never opens as a
  plugin token or a session, and they never open as it.
- **One member, one team, at most an hour.** It carries the team and the
  computer or session it is for. The host that minted it renews it before it
  ends.
- **Two routes accept it:** `GET /api/configs`, which then returns that team
  alone, and the model gateway, which then refuses any other team's model.
  Every other route treats it as nobody, because they call `requireUser`,
  which does not open it.
- **Membership is re-read on every request**, as for a plugin token, so a
  member removed from the team is refused at once.
- **Only an edition mints it**, through `edition.Host.MintComputerToken`, and
  only for a member of that team.

## Consequences

- An agent that reads a computer's token can call its team's models and read
  its team's configuration, which the computer's DSH can do anyway, for at
  most an hour.
- Model calls made with it are metered and budgeted as the member's, like
  their plugin's.
- A host must renew the token; a computer whose host stops renewing it loses
  its team access within the hour.
- Like every sealed value here, it cannot be revoked before it expires; the
  hour and the membership check are the bound.
- Ruled out: a member's plugin token in a VM, and a token that reaches more
  than one team.
