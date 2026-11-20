# 0059. Account verification covers every personal sign-in

> **Status:** Accepted · **Date:** 2026-11-20

## Context

The web console and phone can read the same personal resources. Different verification policies would leave an account accessible through its least protected login.

## Decision

An edition may require one account-wide verification step for personal access. A primary login then issues a short-lived pending cookie. Browser verification creates a session, and phone verification authorizes only the matching PKCE handoff. Both pending credentials expire after five minutes and use distinct token purposes. The edition binds proof to the user, login and handoff challenge.

## Consequences

A new conversation can reuse the authenticated login. Host PIN settings remain independent per computer.
