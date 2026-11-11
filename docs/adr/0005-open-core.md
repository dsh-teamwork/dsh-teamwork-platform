# 0005. Open core: a self-hosted community edition for one team

> **Status:** Accepted · **Date:** 2026-11-10

## Context

Positioning question 5 asked whether the product is open with paid enterprise
features or a closed enterprise edition. DSH itself is open source, and the
product has no users yet. The developer wants people to start using it, and an
open edition anyone can run is the cheapest way to reach them.

The business model is unchanged by this:

- the hosted cloud service;
- the platform capabilities a company pays for;
- consulting.

ADR 0004 put the hosted service first. It left supported private deployment
for a later decision, once the hosted service has paying organisations.

Today's code is one private repository (`dsh-teamwork/platform`). What ships
is team configuration and the model gateway. The parts the positioning puts
first, governance and team assets, are not built yet.

## Decision

**DSH Teamwork becomes open core.** The line is the reader of the feature:

- what **one team** needs is open source;
- what **a company** needs to govern many teams, people and their data is
  closed.

**Open: the community edition**, licensed Apache-2.0 and self-hosted by
whoever runs it:

- sign-in;
- teams and single-use invitations;
- the admin and member roles;
- team configuration: models, presets, plugin pins, and skills when they land;
- the model gateway, which keeps provider keys on the server;
- the plugin's sign-in through the website;
- the `@dsh-teamwork/dsh-teamwork` plugin itself.

**Closed: the cloud service and the enterprise edition:**

- organisations above teams;
- company sign-in (OIDC, SAML) and SCIM;
- roles beyond admin and member;
- the audit log and its export;
- **agents executing in the cloud**: the job queue, the runner and its
  sandboxes;
- stored sessions, workspaces, team memory and registries;
- chat bots;
- the operator console (`apps/manage`), usage and billing.

**The community edition gets its own public repository,
`dsh-teamwork/dsh-teamwork-platform`.** The name carries the product, so a fork
or a clone still says what it is. That repository is the upstream for
everything open: open code is changed there and nowhere else.

This repository stays private and works as a fork of it:

- it merges the public `main` from an `upstream` remote;
- its closed code lives only in directories of its own, so a merge never
  meets a conflict;
- it is what the hosted service deploys.

**Self-hosting the community edition is community use, without support.** A
supported private deployment of the enterprise edition is still ADR 0004's
later decision.

## Consequences

- **The open surface moves to the Maintaining stage when it is released.**
  Someone else's database, installed plugin and minted tokens will depend on
  it. From then on:
  - its migrations only move forward;
  - its wire changes are additive;
  - its token format is kept.

  Moving it is the developer's edit to `CLAUDE.md` at release, not a change
  this record makes. It is the reason to release only once the plugin's wire
  has settled.
- **The schema is split by edition.** Open models and their migrations live
  in the public repository. Closed models live in their own `.prisma` files,
  through Prisma's multi-file schema, and their migrations here. A closed
  migration may reference an open table but never alters one. The migration
  history of a hosted database is then the open history with the closed
  history interleaved, and `db:drift` has to replay both. This is the part of
  the split that is expensive to get wrong.
- **The community edition must run without Shushuo's services.** That means:
  - analytics off unless configured;
  - sign-in codes sent over plain SMTP, Resend optional;
  - Google sign-in optional;
  - one documented `docker compose up`.

  The first release prices this work.
- **Extension points appear, one per closed feature, when it lands.** They are
  the sign-in providers, the authorization check and the audit sink. Each is
  built with the closed feature that fills it, never ahead of it. ADR 0004's
  "no seam for private deployment" still holds for storage and execution,
  which stay closed.
- **Contributions are taken under the Developer Certificate of Origin.**
  Apache-2.0 already allows contributed code to ship in the closed edition,
  so there is no separate contributor agreement.
- **The name and the mark are not licensed.** Apache-2.0 covers the code. A
  fork may not call itself DSH Teamwork or use the whale.
- **The privacy policy covers the hosted service only.** Whoever runs a
  community edition is the controller of its data, and its repository says so.
- **Ruled out:**
  - **A closed feature in the public repository behind a flag or an `ee/`
    directory**, because its code would be public anyway.
  - **Exporting the public repository one way from this one**, because outside
    contributions could not flow back and the two histories would drift.
  - **AGPL**, because the target users are companies whose legal review
    refuses it.
  - **A source-available licence such as FSL**, because the moat is the closed
    edition and the service, not this code, and an open licence spreads
    further.
- **Left open:** the date of the first release, which waits for the plugin's
  wire and a working self-hosted path.
