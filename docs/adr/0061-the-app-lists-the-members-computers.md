# 0061. The app lists the member's own computers, with its own pairings only

> **Status:** Accepted · **Date:** 2026-11-20

## Context

ADR 0048 let the web console list a member's computers (`GET /relay/hosts`)
and refused the app's Bearer there, so that a phone keeps to its own handset
(the hosted edition's ADR 0020). A phone therefore knew only the computers it
had already paired with: a member on their phone could not see which of their
computers were signed in to Teamwork, or which were online, until they paired
one from its panel. The relay recorded no version of the Teamwork plugin
either, so nothing could tell a member which computer ran an old one.

## Decision

**`GET /relay/hosts` also answers the app's Bearer with its handset
credential (`X-Device-Key`, required), listing the same computers with that
handset's own pairings only.** The console's answer is unchanged.

- A phone sees each of its owner's computers: name, operating system,
  whether it is online and when it was last seen, its DSH and plugin
  versions, and whether this phone is paired with it. It sees no other
  device's pairing, name or state; another handset of the same account sees
  the same computers and none of this one's pairings.
- Pairing is unchanged: a code from the computer's panel, the safety codes on
  both screens, the computer's approval. Listing a computer grants nothing.
- The plugin's hello carries `pluginVersion`, recorded on the host
  (`relay_hosts.plugin_version`) and listed beside `dshVersion`. A plugin too
  old to send it is recorded with none; one that sends an empty value is
  refused 4400.

## Consequences

- The app can offer every computer of the member's, paired or not, and say
  which runs an outdated plugin.
- A stolen app token now also reveals the names and online state of the
  member's computers. The same token already reaches those computers through
  its pairings, and the names are the member's own, so the loss is small; the
  pairings of other devices stay out of reach.
- This loosens ADR 0048's refusal of the app on this one route; revoking
  another device's pairing and removing a computer stay the console's alone.
