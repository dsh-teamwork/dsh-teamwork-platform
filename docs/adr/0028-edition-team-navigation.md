# 0028. Same-origin edition team navigation

> **Status:** Superseded by 0041 · **Date:** 2026-11-15

## Context

An edition can embed a member-facing team app independently of the public
console. Members need to discover it and return there after the normal public
sign-in. Hardcoding closed routes in the open router breaks the edition boundary.

## Decision

Expose mount-time `Host.AddTeamPage` with a fixed absolute path prefix and
labels for the two supported locales. Validate a conservative same-origin
path, reject duplicate entries and copy label data. The existing session
response includes `teamPages`, an empty list on community instances. The team
sidebar appends the selected team id and navigates through an ordinary link.

An otherwise unknown public SPA route under a registered prefix performs
document navigation so a sign-in return can load the edition's own HTML.
Extensions serve those routes and enforce authorization in their APIs;
registration is navigation metadata, never a permission grant.

## Consequences

The public bundle contains no closed page implementation or route. Community
navigation needs no optional request or extra loading dependency. Edition
apps retain the existing session, team-scoped URLs and language labels. A
registered app must actually serve its prefix; the metadata cannot stand in
for a page. No external or user-supplied navigation destination is accepted.
