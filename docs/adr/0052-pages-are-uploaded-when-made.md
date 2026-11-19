# 0052. A page is uploaded to the server when an agent makes it

> **Status:** Accepted · **Date:** 2026-11-19

## Context

An agent in a DSH session makes pages: a report, a deck, a dashboard
(`docs/tech/pages.md`). A member wants to open one from any device, including
when the computer that made it is off, and to share it with teammates. Until
now the server stored no session content: the relay carries the conversation
end to end encrypted and keeps only connection and pairing metadata
(`docs/tech/relay.md`), and a Team DSH's members rely on the server never
reading what passes through it (`docs/tech/shared-dsh.md`). The alternatives
were:

- **Keep pages on the computer, and upload only when shared.** Nothing leaves
  the channel until a person decides, but a page cannot be opened while its
  computer is off, every client needs a second way to fetch one through the
  relay, and the shared copy and the local one drift.
- **Upload when made**, private to its maker.

## Decision

**The plugin's `teamwork_page` tool uploads a page's files to the team's
server the moment the agent publishes it, private to the member whose session
made it.**

- Only what the agent deliberately publishes through the tool is uploaded:
  the files it names, a title, a one-line note, the session's id and the
  computer's name. The conversation around it stays where it was.
- A page belongs to the team of the session's preset, as other team tools
  decide it, and is owned by the member (on a Team DSH, the session's
  starter).
- Its sharing starts `private`; only a person widens it, never the tool.

## Consequences

- A page opens on any device signed in to the team, the computer on or off,
  and sharing it is a change of rows, not a transfer.
- The relay's promise is narrowed: the server stores no session content
  except the pages agents publish. `relay.md` and `shared-dsh.md` say so, and
  the hosted service's privacy policy says so before pages ship there.
- A page is stored by the team's server like a plugin archive, in the same
  object store and backups.
- Ruled out: pages that exist only on a computer, and a second transfer path
  through the relay for them.
