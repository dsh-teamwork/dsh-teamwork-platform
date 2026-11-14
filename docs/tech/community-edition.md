# Community edition split

> **Status:** Current — the first release waits · **Updated:** 2026-11-14

How the open community edition, the public `dsh-teamwork/dsh-teamwork-platform`
(ADR 0005), and the closed edition built on it stay two repositories with one
open tree: what lives where, the boundary between them, and how open work
reaches the closed side.

## In one paragraph

**The public repository is the whole community edition; the closed one is the
same tree plus `premium/`.** Open work is done in the public repository and
merged into the closed one from `upstream`. A check in the closed
repository's gate fails when any open path there differs from the upstream
commit last merged, so an open file is never edited on the closed side. The
closed server is the open one with closed Go packages compiled in through
`server/edition` ([ADR 0014](../adr/0014-one-go-binary.md)), so a closed
feature adds code and never changes open code.

## What it gives

1. **Anyone can self-host the community edition with one command**
   (ADR 0006): `npx @dsh-teamwork/server`, a release binary, or
   `compose.yaml`. That gives one team the whole open product: sign-in by
   password, or by an emailed code over SMTP where one is configured, with
   Google optional; teams and invitations; team configuration; the model
   gateway; `/teamwork login` and `/teamwork sync` from DSH. It needs no
   Google, PostHog or Resend account.
2. **The public repository holds no closed code, no internal document and no
   secret.** Its history starts at the split ("Initial community edition",
   `49a2bb4`).
3. **The closed repository merges `upstream` without a conflict**, apart from
   the lockfile, which is regenerated rather than merged.

## Non-goals

- **A supported private deployment of the enterprise edition** (ADR 0004).
- **Keeping the closed repository's history in the public one.** It carries
  internal documents.
- **Changing the plugin's wire for the release.** The first release waits
  for it to settle.

## What goes where

| Part | Public `dsh-teamwork-platform` | Closed repository only |
| --- | --- | --- |
| `server/` | The whole server: every route, the model gateway, sign-in, the schema and migrations of three dialects, and `server/edition`, the extension point | — |
| `apps/console` | The console and the public pages; `/privacy` and `/terms` from a build's `LEGAL_DIR` | The hosted service's legal text, `premium/docs/legal/` (ADR 0007) |
| `packages/shared` | The languages and the rule that picks one | — |
| `premium/server` | — | The closed binary: the open server with the relay and the operator console registered, their tables and migrations |
| `premium/apps` | — | The operator console's pages and the mobile app |
| Brand | `docs/brand/icon.svg`, `docs/design.md`, the exported icons; the name and mark are not licensed (ADR 0005) | — |
| Docs | `docs/`, the open ADRs | `premium/docs/`: positioning, the SaaS route, ops, legal, ADRs 0003 and 0004 |
| Agent instructions | `CLAUDE.md`, `AGENTS.md` | `premium/CLAUDE.md`, read before touching `premium/` |
| Changelog | `CHANGELOG.md` for the open product | `premium/CHANGELOG.md` |
| Self-hosting | `server/Dockerfile`, `compose.yaml`, the npm packages and release binaries (`.github/workflows/release.yaml`) | — |
| Licence and contributing | `LICENSE` (Apache-2.0), `NOTICE`, the README's DCO request, CI on pull requests | `premium/LICENSE`, proprietary |
| Deployment | — | The Railway services and their runbook in `premium/docs/ops/` |

**The closed path is `premium/**`.** Nothing else in the closed repository
may differ from the public one.

**A closed table refers to an open row by its id alone**, with no foreign
key, and a closed package never queries an open table: what it needs of one
comes through `edition.Host` (`Users`, `Bearer`, `Session`). Its migrations
are its own, applied after the open ones and recorded under its name, so the
two histories never interleave. Keeping such references whole is the closed
code's job; where closed rows must follow an open row's deletion, that is an
extension point, built with the first feature that needs it.

`pnpm-workspace.yaml` lists `premium/apps/*`, `premium/packages/*` and
`premium/server` in both repositories. pnpm skips a glob that matches
nothing, so the public repository carries the lines harmlessly and the file
never diverges.

## The hosted home page

The open server's `/` is the landing page on every instance (ADR 0007), and
each deployment publishes its own legal pages from `LEGAL_DIR`; the hosted
service builds its image with `premium/docs/legal/`. A self-hosted instance
built without one publishes neither, so no open page links legal text that
names Shushuo.

## How the two stay in step

- **Open work happens in the public repository.** A pull request there runs
  the full gate in CI, so outside contributions get it too.
- **The closed repository takes it with `git merge upstream/main`** and then
  `pnpm install`, which regenerates the lockfile. Its gate then runs
  `premium/scripts/lint-edition.mjs`, which finds the last upstream commit
  merged into `HEAD` and fails when any path outside `premium/` and the
  lockfile differs from it. Measuring against the last merged commit, not
  upstream's tip, keeps the check green while a new upstream commit waits. A
  conflict outside the lockfile means an open file was edited on the closed
  side; the fix is to move that edit upstream.
- **A closed feature never edits an open file.** Where open code must call
  it — a sign-in door, an authorization check, an audit sink — that
  extension point is added upstream first, as an open change with a working
  open default, in the same piece of work as the closed feature that fills
  it. `server/edition` is the first: routes, tables and migrations.
- **The plugin** states the oldest server version it works with. Once the
  open surface is maintained, the server's wire only grows, so a newer server
  never breaks an older plugin.

## What is left: the first release

Gated on the plugin's wire having settled.

- Make the plugin repository public, relicensed Apache-2.0: a `LICENSE` file
  and `"license": "Apache-2.0"` in its `package.json`.
- Tag `v0.1.0` in the public repository, which publishes the npm packages,
  the release binaries and the image, with its `CHANGELOG.md` entry and a
  GitHub release.
- The developer moves the public repository's stage line to Maintaining, and
  the closed repository's line for the open surface with it (ADR 0005).

## How it is verified

- **CI on every pull request** runs the gate, the plugin's end-to-end test,
  the packed `npx` run on Linux, macOS and Windows, and a `self-host` job that
  builds `server/Dockerfile`, starts `compose.yaml` with no `.env`, and checks
  the server answers and keeps its data across containers.
- **`lint:edition` passes in the closed repository** and fails when an open
  file is edited there.
- **The public repository's history** is the one initial commit and what was
  merged since; the tree was scanned for secrets at the split.
