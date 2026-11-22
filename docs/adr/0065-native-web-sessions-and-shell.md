# 0065. Native Web runs in a shell on its own origin, with idle sessions the computer can end

> **Status:** Accepted · **Date:** 2026-11-22

## Context

ADR 0064 opens a personal DSH's whole Web interface through the relay. Its
access cookie lasts eight hours whether or not anyone uses it, the browser
shows the bare DSH page with no sign of where it runs, and the computer has
no way to see or end the access it allows. The owner asked for:

- access that closes when unused;
- access bound to the client that opened it;
- a thin Teamwork bar above DSH, with the connection state, the way back to
  Teamwork and the traffic;
- the DSH page reachable only inside that bar, not from the address bar.

The owner proposed serving the bar from `dshteamwork.com` and framing
`<label>.d.dshteam.work` in it. That frame would be a different site, which
breaks three things:

- The access cookie would be third-party. Safari, and so every iOS browser and
  the phone app's in-app browser, refuses third-party cookies.
- The framed load would arrive as `Sec-Fetch-Site: cross-site`. Admitting it
  would undo `edition.FromOwnPages` without telling which site framed it.
- Requiring `Sec-Fetch-Dest: iframe` stops no one holding a stolen cookie, who
  can send that header themselves.

## Decision

- **Session table.** Each entry through a ticket becomes a session in the
  gateway's memory, kept per computer. The sealed cookie names the session and
  carries a hash of the User-Agent that entered.
- **When a request is refused.** A request is refused when:
  - its session is unknown or ended;
  - its User-Agent differs from the one that entered;
  - no byte has moved for the session for thirty minutes;
  - eight hours have passed since entry.
- **What counts as activity.** Bytes in either direction count, an open
  WebSocket's included. The shell's own status polling does not count.
- **Not done.** The session is not bound to the client's address, which a
  phone changes between networks. The computer is not asked to confirm each
  entry, which would defeat use away from it. There is no separate "open on
  demand" step: the server decides when to open either way.
- **The shell.** The bar is a shell page the gateway serves on the computer's
  own origin, under reserved paths (`/__dsh/`). The shell frames that same
  origin's DSH, so cookies stay first-party and Fetch Metadata stays
  `same-origin`. A top-level navigation to any other path is redirected into
  the shell. Proxied pages may be framed only by their own origin
  (`frame-ancestors 'self'`). The shell itself may be framed by no one.
- **What the computer sees.** The computer sees how many tunnels it serves and
  when one last moved. One command, from the Teamwork panel or
  `dsh-teamwork web disconnect`, ends every session of the computer at once
  without reconnecting its phones.

## Consequences

- **Gains.** Access no longer outlives its use by hours. A copied cookie needs
  the same User-Agent, and dies with the session. The person using it sees
  which computer they are on and can leave or end it. The owner at the
  computer can see use and stop it.
- **New state and cost.** The gateway keeps per-computer session state in
  memory again, bounded per computer, replacing ADR 0064's stateless cookie.
  A restart of the gateway ends every session, as before.
- **Effect on DSH.** DSH runs one frame down. Its own links that open a new
  window land in a new shell, and features that need a top-level page
  (fullscreen, the clipboard) are granted on the frame.
- **Ruled out.**
  - A bar or frame from the platform's site.
  - Address binding.
  - Per-entry confirmation on the computer.
  - Treating the iframe requirement as a security boundary: it is how the shell
    is used, not what keeps a stolen cookie out.
