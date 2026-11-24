# 0068. Knowledge is its own module, and pages are html and svg

> **Status:** Accepted · **Date:** 2026-11-24

## Context

Pages ([ADR 0052](0052-pages-are-uploaded-when-made.md),
[`docs/tech/pages.md`](../tech/pages.md)) are what an agent publishes from a
session: a report, a deck, a dashboard, a diagram, in one of three kinds,
`html`, `markdown` or `svg`. The hosted edition's positioning had them grow
into the team's knowledge base as well: people writing and editing pages, an
agent reading them as context, the team's notes beside its reports.

Teams also need a place to keep what the business knows, so that it stays
the team's when people and sessions move on, and Chinese teams cannot simply
use Notion. Weighing one module against two, the two things turned out to be
managed differently, not only formatted differently:

- a page is shown to people: rich media in a sandbox, made by one person's
  agent, private until its owner shares it, replaced whole by a new version,
  and done once it has been read and reviewed;
- knowledge is kept together: formatted text in a tree of folders, owned by
  the team and readable by it by default, edited a part at a time by people
  and proposed by agents, read by agents as context, and kept true for as
  long as it is used.

Their threats differ as well: a page's scripts must not act as the person
viewing it, while a knowledge document's text reaches an agent's context and
must not be changed without a person agreeing.

## Decision

**Knowledge is a module of its own, beside pages, with its own data, rules
and screens** ([`docs/tech/knowledge.md`](../tech/knowledge.md)). The two
share what is genuinely the same underneath (object storage, the re-check of
team membership, how versions are numbered) and link to each other, but
neither takes the other's rules.

**Pages keep `html` and `svg`; the `markdown` kind is removed.** A Markdown
page would sit between the two, with no clear answer to which one a document
belongs in; formatted text is knowledge's.

The knowledge module is also the one knowledge base of the hosted edition:
its bots read it, and the "uploaded knowledge base" of its shared-computers
version is this module rather than a second store.

## Consequences

- Pages stay what they are: published by an agent, shown in a sandbox, never
  edited in the browser. The non-goals of `pages.md` hold.
- Removing the `markdown` kind changes the `pages.kind` column (a migration),
  `api/openapi.yaml`, the server's Markdown rendering and its dependency, the
  relay client's page item and the plugin's `teamwork_page` tool. Nothing has
  shipped, so a Markdown page already stored is deleted rather than moved.
- A team gets two places where work is kept, and the console has to make the
  difference obvious: pages under **Shared pages**, knowledge under its own
  entry.
- Knowledge needs what pages deliberately left out: browser editing, a
  folder tree, team-wide ownership and review of an agent's changes. Each is
  designed there, not added to pages.
- Ruled out: one "page" type that carries both uses with a kind or a flag,
  and a knowledge base that stores documents as pages.
