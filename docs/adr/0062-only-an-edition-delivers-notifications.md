# 0062. Only an edition delivers notifications

> **Status:** Accepted · **Date:** 2026-11-20

## Context

ADR 0044 moved the relay into the open server with push notifications
through Expo's public endpoint, which needs no credential from the sender, so
every server, a self-hosted one too, could notify the official app.

Most of the product's users are in mainland China, where most Android phones
have no Google services and FCM, behind Expo, never reaches them. Reaching
them takes the phone makers' own channels, through an aggregator such as
JPush or Getui, and every one of those authenticates the sender with the
app's own secret. A secret that ships with the open server is no secret, so a
self-hosted server cannot send through them. Keeping Expo for self-hosted
servers alone would leave two delivery paths, one of which misses most of the
product's users, and an app that has to tell a member why one server notifies
their phone and another does not.

## Decision

**The open server delivers no notifications of its own; an edition gives it
a sender (`edition.Host.SetPush`), and only a server given one offers or
sends them.**

- The relay still decides who is told and when (`server/relay/push.go`): the
  waiting signal, the confirmed pairings that gave a token, the one-a-minute
  quiet window, the language. Only delivery is the edition's.
- `GET /api/relay` says `push: true|false`; the app offers notifications only
  where it is true. Without a sender, turning them on is 409
  `push_unavailable`, while turning them off still succeeds.
- The hosted edition sends through Expo today, and adds the aggregator for
  the app's mainland Android builds when it has the company that the channels
  and the stores require.

## Consequences

- A self-hosted server, and the community edition as released, sends no push
  message to anyone and needs no push setting. Its members still see what
  waits on them whenever the app or the web console is open.
- What a notification may carry, a computer's name and a pairing id, is
  `edition.PushMessage`, so an edition's sender cannot be handed more.
- Ruled out: shipping push credentials in the open server, a self-hosted
  server relaying its notifications through the hosted service, and Expo kept
  as a default beside an edition's sender.
