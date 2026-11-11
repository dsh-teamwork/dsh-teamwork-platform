/*
 * Prisma configuration — the one place DATABASE_URL is resolved.
 *
 * This file is intentionally identical across every repo, so that "how does
 * Prisma find the database here" is never a per-project question.
 *
 * The URL is looked for in this order and the first file that defines it wins,
 * but a variable already present in the real environment beats all of them
 * (`override: false`) — so CI, Docker and Railway need no file at all:
 *
 *   1. packages/db/.env      this package's own, for schema-only work
 *   2. <repo root>/.env      a workspace-wide value
 *   3. apps/web/.env         where the app that owns the schema keeps it
 *
 * Paths resolve from the current directory, which is the package directory for
 * every `db:*` script — pnpm and turbo both run a package script from its own
 * folder. scripts/assert-local-database.mjs repeats this exact list so the
 * guard and Prisma can never be looking at two different databases.
 *
 * The localhost default describes the `pnpm dev:setup` stack, so it only
 * applies when nothing above supplied a URL. Once a real DATABASE_URL is in
 * play the shadow database is deliberately left undefined: Prisma then
 * provisions it next to the real one, whereas a localhost fallback would send
 * a migration on a deployed database looking for Postgres on the operator's
 * own laptop.
 */
import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

for (const file of [".env", "../../.env", "../../apps/web/.env"]) {
  config({ path: path.resolve(process.cwd(), file), override: false, quiet: true });
}

const DEV_DATABASE_URL = "postgresql://postgres:postgres_password@localhost:5432/dsh_teamwork";

const databaseUrl = process.env.DATABASE_URL;

const shadowDatabaseUrl =
  process.env.SHADOW_DATABASE_URL ?? (databaseUrl ? undefined : "postgresql://postgres:postgres_password@localhost:5432/prisma_shadow");

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl ?? DEV_DATABASE_URL,
    shadowDatabaseUrl,
  },
});
