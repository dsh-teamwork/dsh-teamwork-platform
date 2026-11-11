# 0002. The platform is rebuilt from seed: one Next.js app, deployed on Railway

> **Status:** Accepted · **Date:** 2026-11-10

## Context

The platform MVP grew in `apps/web` (Next.js 15, next-auth v4 with a fixed
development OTP, Prisma 6 with a hand-written migration runner) beside a
Fastify `apps/api`, a Lark bot and Kubernetes/Terraform stubs that carried no
traffic. Every sibling product at Shushuo starts from `~/code/shushuo/seed`
and shares its stack, gate, documentation layout and Railway deployment.

## Decision

Start the repository again from seed (`pnpm rename dsh-teamwork 38 --auth nextauth`),
keep `apps/web`, `apps/manage`, `packages/db` and `packages/shared`, delete the
mobile app, the store pipeline and `packages/s3`, and port the MVP's rules onto
it: the team API as one route file per resource under `/api`, the model
gateway, and the plugin sign-in of ADR 0001. `apps/api`, the Lark bot and
`infra/` are deleted. Local Postgres runs from this repository's `dev/`, as in
seed but without rustfs, or from the shared `~/code/shushuo/dev` stack under
the same database names.

## Consequences

- The API moved from `/api/v1/*` to `/api/*` with new paths and error codes
  instead of Chinese sentences; the plugin changed with it. Nothing was
  deployed, so nothing else had to move.
- Real sign-in (Google, emailed codes) replaces the fixed OTP, which is gone.
- Deployment is Railway (`railpack.json`), not Kubernetes; scaling past one
  web service is Railway's replicas, not a manifest here.
- Conventions copied from seed are kept in step by hand, as every sibling does.
