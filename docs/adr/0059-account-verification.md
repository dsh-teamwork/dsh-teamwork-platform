# 0059. Account verification covers every personal sign-in

> **Status:** Accepted · **Date:** 2026-11-20

## Context

The web console and phone can read the same personal resources. Different verification policies would leave an account accessible through its least protected login.

## Decision

An edition may require one account-wide verification step for personal access. A primary login then issues a short-lived pending cookie. Browser verification creates a session, and phone verification authorizes only the matching PKCE handoff. Both pending credentials expire after five minutes and use distinct token purposes. The edition binds proof to the user, login and handoff challenge.

## Consequences

- There is one switch per account, not one per client. A preference per entry
  point was tried and rejected: the browser and the phone both end in
  credentials that reach the same routes (a session, or a plugin Bearer that
  `requireUser` accepts everywhere), so verification on one entry was bypassed
  through the other with the first factor alone.
- The DSH plugin's loopback handoff needs a full browser session, so it is
  verified whenever the browser is. Only the phone's handoff has a pending
  credential of its own, and it can mint a code for its one challenge, nothing
  else.
- A first factor alone no longer yields a session on a gated account, so an
  edition must serve the step that completes it (`Host.CompleteLogin`) and the
  proof the phone's handoff consumes (`SignInGate.ConsumeAppProof`); the
  community edition registers no gate and keeps its single step.
- Sign-out ends the browser's login before an edition's cleanup runs, and a
  cleanup failure is logged rather than returned: a grant that outlives its
  login still expires with it.
- Verification happens at sign-in only. A session or token issued before the
  switch was turned on keeps working until it expires, as ADR 0014's
  stateless tokens already imply.
- A management process (`SERVICE_ROLE=manage`) applies the gate only where an
  edition registers it there. The hosted edition does not: its operator
  console admits only allowlisted Google sessions on an origin of its own.
- Host PIN settings remain independent per computer. A new conversation reuses
  the authenticated login.
