# 0063. Owners may open a personal DSH's native Web

> **Status:** Accepted · **Date:** 2026-11-21

## Context

The paired Relay exposes selected session operations. Owners also need the
original DSH UI, including configuration and plugin management, from a browser.

## Decision

A personal DSH may opt in through its Teamwork plugin. The owner requests a
single-use ticket through the platform session or mobile Bearer. It becomes a
host-only cookie on an origin that is independent of the platform's
registrable domain. Browser writes and upgrades require that exact origin.

The existing authenticated host connection requests one outbound data socket
for each upstream HTTP connection. The plugin signs in to the native Web
listener of its current host and applies that local credential on the
computer. The tunnel carries byte streams, including upgraded WebSockets.
Only a personal host with its Web listener available can opt in. The first
implementation leaves the entry unavailable when the host has a local PIN.

## Consequences

The platform terminates HTTPS and proxies the full owner interface, while the
paired session path retains its separate encryption. The gateway needs
wildcard DNS and TLS. Live tunnels and tickets are tied to the gateway process
and the connected host. Closing that host connection also closes its
forwarded streams.
