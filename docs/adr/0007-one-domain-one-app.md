# 0007. One domain, one app: the web app is the home page

> **Status:** Accepted · **Date:** 2026-11-12

## Context

The hosted service ran on three addresses: a closed landing site
(`premium/apps/site`) on `dshteamwork.com`, the web app on
`alpha.dshteamwork.com`, and the operator console on `manage.`. The site
existed because the landing page linked `/privacy` and `/terms`, whose text
names Shushuo as the data controller, and an open page linking them would 404
on every self-hosted instance (`docs/tech/community-edition.md`, "The hosted
home page").

That cost a second Next.js app and Railway service, and gave the product two
public origins. The DSH plugin, whose default server is the product's own
domain, could not sign in at `dshteamwork.com`: `/plugin` and `/api/*` live on
the web app. The developer decided the root domain should both introduce the
open-source project and serve the hosted service.

## Decision

The web app serves the root domain, and `alpha.` and the separate site are
retired. The landing page becomes the open web app's `/` on every instance:
what DSH Teamwork is, as a project and as a service, and the way in. Legal
pages are a deployment's own: `LEGAL_DIR` names a directory holding
`privacy.md` and `terms.md` (`apps/web/src/lib/legal.ts`), read once at build
into static `/privacy` and `/terms`. With it unset the two routes answer 404,
and the footer and the sitemap leave them out. The hosted service sets
`LEGAL_DIR=premium/docs/legal`.

## Consequences

- One app and one service fewer; one public origin, which is also the plugin's
  default server.
- A self-hosted instance shows the same introduction on its `/` and can
  publish its own policy and terms the same way.
- `LEGAL_DIR` is the switch the earlier decision refused. It is a
  deployment's content, not a flag beside an old path: without it there is
  simply nothing to publish.
- The landing page's copy is open, so a claim on it must hold for any
  instance. Copy about the hosted service alone belongs in the legal documents
  or the closed edition.
- Moving the web app's origin signs every browser out once (Auth.js cookies
  are per host) and needs Google's OAuth callback for the root domain. Plugin
  tokens do not depend on the host.
