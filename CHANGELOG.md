# Changelog

Every key change to DSH Teamwork, newest first, by date. An agent starting a
task reads the top of this file to learn what moved recently; git holds the
detail. What counts as key, the entry format and how old entries are compacted
are in `CLAUDE.md`, "The changelog".

## 2026-11-11 — Passwords when SMTP_URL is unset

- **What:**
  - Without `SMTP_URL`, sign-in is an email and a password instead of an emailed code. Passwords are kept as scrypt in a new `passwords` table, with ten guesses per account per fifteen minutes.
  - The server prints a link at start that claims the first account.
  - A team admin creates members with a first password, shown once, which they must change before `/team` or `/plugin` open, and resets it the same way.
  - New routes: `POST /api/team/members` and `POST /api/team/members/:userId/password`.
  - A session's `via` can be `password`; the console refuses it.
  - The development fallback that printed a code to the console without SMTP is gone.
- **Why:** ADR 0006, Phase 4 step 3 of `docs/tech/community-edition.md`: an instance with no mail server still has a way in.
- **Breaking:** A development server without `SMTP_URL` now asks for a password instead of printing a code.
- **Upgrade:** Migration `20261111143836_passwords` (`pnpm db:deploy`, or automatic on PGlite). An instance with `SMTP_URL` set needs nothing else.
- **Refs:** ADR 0006, `packages/shared/src/server/auth/nextauth/passwords.ts`.

## 2026-11-11 — PGlite when DATABASE_URL is unset

- **What:** Without `DATABASE_URL`, the apps run on PGlite, an in-process Postgres. Its data directory is `PGLITE_DIR` (default `~/.dsh-teamwork/db`). It applies the committed migrations on first connect and records them as Prisma does. The suites that needed Postgres now always run, on PGlite in memory, and CI runs them on both databases. The apps no longer fall back to the `pnpm dev:setup` stack; the Prisma CLI still does. New exact dependencies: `@electric-sql/pglite` 0.5.16 and `pglite-prisma-adapter` 0.7.2.
- **Why:** ADR 0006: the community edition runs from one command; Phase 4 step 2 of `docs/tech/community-edition.md`.
- **Breaking:** A process started with no `DATABASE_URL` now opens a PGlite directory instead of connecting to `localhost:5432`.
- **Upgrade:** `pnpm install`. Keep `DATABASE_URL` set (as `apps/web/.env.example` does) to stay on Postgres.
- **Refs:** ADR 0006, `packages/db/src/pglite.ts`.

## 2026-11-11 — The community edition is public

- **What:** This repository, `dsh-teamwork/dsh-teamwork-platform`, is the community edition's own home and the upstream of the closed edition. Open changes are made here and merged there. The pre-push hook and CI also run the edition boundary check wherever the closed edition's script exists, which is never in this repository.
- **Why:** ADR 0005; Phase 3 of `docs/tech/community-edition.md`.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/tech/community-edition.md`.

## 2026-11-11 — Apache-2.0, and CI on pull requests

- **What:** The repository is licensed Apache-2.0 (`LICENSE`), with a `NOTICE` keeping the name and the whale mark out of the licence, and a README section asking for a `Signed-off-by:` line on every commit (the DCO). CI runs on every pull request as well as on `main`, and a `self-host` job builds `apps/web/Dockerfile`, starts `compose.yaml` and checks the web app answers. The root `dev:manage` script is gone.
- **Why:** The community edition is about to be published (ADR 0005, `docs/tech/community-edition.md`).
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `README.md`, `NOTICE`, `.github/workflows/ci.yaml`.

## 2026-11-10 — The web app's home page becomes a start page

- **What:** `/` in `apps/web` is a short start page: the logo, the name and tagline, and one way in (sign in, or open your team). The landing page, the share card, the JSON-LD, `/privacy`, `/terms` and their build step (`pull-legal.mjs`) are no longer part of the web app, which drops `react-markdown` and `remark-gfm`. The language check exempts every app's `messages/`; the root `CLAUDE.md` copies seed's lint-docs and Documentation section (a second documentation tree; legal pages only where published).
- **Why:** A self-hosted instance needs a way in, not the hosted service's landing page or its legal pages, which name Shushuo as the controller (`docs/tech/community-edition.md`).
- **Breaking:** `/privacy` and `/terms` are gone from the web app's origin.
- **Upgrade:** Nothing.
- **Refs:** `docs/tech/community-edition.md`, `docs/design.md`.

## 2026-11-10 — The schema moves to a folder; the icon script finds every app

- **What:** The Prisma schema is `packages/db/prisma/schema/schema.prisma`, a folder other `.prisma` files can join; the generator's output, `prisma.config.ts`, the drift script and turbo's input follow it. `pnpm-workspace.yaml` also matches `premium/apps/*` and `premium/packages/*`, which match nothing in the community edition. `generate-icons.mjs` exports for every app it finds instead of a fixed list, so every app gets the same tab, home-screen and logo files.
- **Why:** The community edition split (`docs/tech/community-edition.md`): the open schema and scripts must name nothing they cannot find.
- **Breaking:** None.
- **Upgrade:** `pnpm install`.
- **Refs:** `docs/tech/community-edition.md`.

## 2026-11-10 — The web app can be self-hosted

- **What:**
  - Sign-in codes go over SMTP (`SMTP_URL`, sent with nodemailer) instead of Resend's HTTP API.
  - The Google provider and its button exist only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.
  - The gateway accepts a plain `http://` provider only when its host resolves to loopback or private addresses.
  - `apps/web/Dockerfile` and `compose.yaml` run Postgres and the web app, and the README's self-hosting section explains them.
- **Why:** The community edition must run without Shushuo's services (ADR 0005, `docs/tech/community-edition.md`), including against a model the team serves itself.
- **Breaking:** `RESEND_API_KEY` is no longer read: a deployment sends no sign-in code until it has `SMTP_URL`.
- **Upgrade:** Set `SMTP_URL` (any SMTP server; Resend's is `smtps://resend:<API key>@smtp.resend.com:465`) and drop `RESEND_API_KEY`. Locally, leave it unset to have codes printed.
- **Refs:** `docs/tech/community-edition.md`, `README.md`.

## 2026-11-10 — The product gets its mark and palette

- **What:** `docs/brand/icon.svg` is the whale mark: a paper fluke tilted into a calm sea on an indigo plate (`#1E2F6D`). Both apps' token scales move from seed's greyscale to the brand's: warm paper grounds and indigo ink in light, indigo-black in dark, `--brand` indigo. The in-app logo keeps its plate with rounded corners, so each app has one `public/logo.svg` for both themes; `logo-dark.svg` is gone and `scripts/generate-icons.mjs` exports the logos that way. The share card shows the logo beside the name and tagline, on paper, set in Onest, whose two latin `.woff` files and OFL licence live in `apps/web/assets/fonts`.
- **Why:** The product had seed's placeholder mark and greyscale scale; this is the identity chosen for it.
- **Breaking:** None.
- **Upgrade:** Nothing.
- **Refs:** `docs/design.md`.

## 2026-11-10 — The platform is rebuilt from seed

- **What:** The repository starts again from `~/code/shushuo/seed` at `3f2e262` (`pnpm rename dsh-teamwork 38 --auth nextauth`): Next.js 16 / React 19, Prisma 7 in `packages/db`, Zod 4, Turborepo, the husky gate and seed's docs layout. The MVP's rules are ported onto it: teams, single-use invitations, team configuration (models, presets, plugin pins) with optimistic versions, and the model gateway. The API moved from `/api/v1/*` to one route per resource under `/api/*`, answering `{ error: <code> }` with `TEAM_ERRORS`. Sign-in is Google or an emailed code; the plugin signs in through `/plugin` and `POST /api/auth/plugin/token` with a stateless 30-day token. `apps/api`, `apps/bot-lark`, `website/`, `infra/`, `packages/core`, the mobile app, the store pipeline and `packages/s3` are gone. Local Postgres comes from this repository's `dev/` (`pnpm dev:setup`) or from the shared `~/code/shushuo/dev` stack (`pnpm dev:shared`), with the same database names in both.
- **Why:** Every Shushuo product shares seed's stack, gate and deployment; the MVP had drifted from all three and could not be deployed safely (its only sign-in was a fixed development code).
- **Breaking:** The plugin's API paths, its sign-in exchange and the error shape. `@dsh-teamwork/dsh-teamwork` changes in step; nothing was deployed.
- **Upgrade:** `pnpm install`, `pnpm dev:setup` (or `pnpm dev:shared`), copy each `.env.example`, `pnpm db:deploy`. New variables: `AUTH_SECRET`, `AUTH_GOOGLE_*`, `RESEND_API_KEY`, `LLM_ROUTES_JSON` and the keys it names. Removed: `NEXTAUTH_*`, `DEV_FIXED_OTP*`.
- **Refs:** `docs/adr/0001-plugin-sign-in.md`, `docs/adr/0002-platform-from-seed.md`, `docs/tech/architecture.md`.

## Before 2026-11-10

The MVP (`60d681c`…`4f83905`): a Next.js 15 app with a fixed development OTP
and a hand-written SQL migration runner, which nothing deployed. Its tables
are not carried over; the migration history starts with seed's.
