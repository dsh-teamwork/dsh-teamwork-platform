# 0069. Pages become artifacts, and plugin archives become packages

> **Status:** Accepted · **Date:** 2026-11-24

## Context

What an agent publishes from a session for people to see is called a page
([`docs/tech/pages.md`](../tech/pages.md)), and "artifact" names the plugin
archives a member submits and installed plugins download
([`docs/tech/team-assistant.md`](../tech/team-assistant.md), "Private plugin
artifacts"). With knowledge beside it
([ADR 0068](0068-knowledge-is-its-own-module.md)), "page" is the word a
person or an agent reaches for when they mean a document in a knowledge
base, as Notion uses it, while what agents publish is what assistants such as
Claude call artifacts, and is already served from `artifacts.dshteam.work`.
In this repository "page" also names the console's screens
(`apps/web/src/pages/`, `TeamPage`) and the prerendered public pages.

## Decision

**What an agent publishes for people to see is an artifact, in code and in
the console's English** (the Chinese console keeps "shared pages"). **A
knowledge document is a document in code**, never a page; to people and to
agents the product understands both "document" and "page" for it: the
plugin's tool descriptions and the preset context name knowledge documents
"documents (pages)", and an agent asked for a team's page is pointed at
knowledge. **The plugin archives that held "artifact" become packages**: npm
tarballs are packages, and the generic object store under both becomes
`objectstore`.

| Now | Becomes |
| --- | --- |
| `server/internal/artifactstore` | `server/internal/objectstore` |
| `resource_artifacts`, `ResourceArtifact` | `plugin_packages`, `PluginPackage` |
| `/api/teams/{teamId}/artifacts[/{id}[/download]]` | `/api/teams/{teamId}/packages[/{id}[/download]]` |
| `artifact_*` and `unsafe_artifact` error codes, `artifactId` | `package_*`, `unsafe_package`, `packageId` |
| the plugin's `teamwork-artifacts` cache | `teamwork-packages` |
| `server/internal/pages` | `server/internal/artifacts` |
| `pages`, `page_versions`, `page_files`, `page_members` | `artifacts`, `artifact_versions`, `artifact_files`, `artifact_members` |
| `/api/teams/{teamId}/pages/*` | `/api/teams/{teamId}/artifacts/*` |
| `page_*` error codes, `auth.PageView` (`dsh-teamwork.page-view`) | `artifact_*`, `auth.ArtifactView` (`dsh-teamwork.artifact-view`) |
| `/p/{token}/` on `CONTENT_URL` | `/a/{token}/` |
| `teamwork_page`, `presentationMeta.teamworkPage` | `teamwork_artifact`, `teamworkArtifact` |
| the relay client's `page` item, the console's `/teams/{teamId}/pages` and `team.pages.*` | `artifact`, `/teams/{teamId}/artifacts`, `team.artifacts.*` |
| the phone app's `page/[teamId]/[pageId]` | `artifact/[teamId]/[artifactId]` |
| `docs/tech/pages.md` | `docs/tech/artifacts.md` |

`CONTENT_URL` keeps its name: it serves artifacts' content.

## Consequences

- One change across the platform, the plugin and the closed edition, made
  with the removal of the `markdown` kind (ADR 0068): the packages first,
  since `/artifacts` must be free before artifacts take it, in one release
  of the server and the plugin together. Nothing has shipped, so there is no
  alias for an old name, no redirect from `/pages` and no shim for an older
  plugin; a plugin older than the release is refused and its pin is raised.
- The tables are renamed by a migration in all three dialects; the history
  before it keeps the old names, as an append-only history does.
- Documents that cite the old names (ADRs 0052, 0053 and others) keep them as
  a record; current documents are edited with the change.
- "Page" stays free in code for the console's screens and the public pages,
  and is never used for knowledge or artifacts.
