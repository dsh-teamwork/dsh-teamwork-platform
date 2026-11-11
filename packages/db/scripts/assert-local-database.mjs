/*
 * Preflight for the `db:*` commands that are local-only.
 *
 * `prisma migrate dev` is a development command: it diffs the schema, writes a
 * new migration, provisions a shadow database, and — when it finds drift or a
 * history it cannot reconcile — offers to reset the database it is pointed at.
 * Run against production it will, at best, apply an uncommitted migration
 * nobody reviewed, and at worst prompt to drop the schema. `migrate reset` and
 * `db push` are the same hazard with none of the hesitation.
 *
 * Deployed databases take committed migrations only, via `pnpm db:deploy`
 * (`prisma migrate deploy`), which never generates, never resets, and never
 * needs a shadow database.
 *
 * So: refuse to run any of them against anything that is not a local database.
 * ALLOW_REMOTE_MIGRATE_DEV=1 exists for the one case this cannot know about —
 * a tunnel to a throwaway database — and is deliberately inconvenient to type.
 *
 * The command being guarded is passed as argv[2] purely so the refusal names
 * it; the check itself is the same for all of them.
 */
import { config } from "dotenv";
import path from "node:path";

// Same lookup order as prisma.config.ts, and for the same reason: the guard has
// to see exactly the DATABASE_URL that Prisma is about to be handed, or it
// would wave through a command aimed at a database it never looked at.
for (const file of [".env", "../../.env", "../../apps/web/.env"]) {
  config({ path: path.resolve(process.cwd(), file), override: false, quiet: true });
}

const COMMAND = process.argv[2] ?? "prisma migrate dev";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal", "postgres", "db"]);

const url = process.env.DATABASE_URL;

// No URL at all means prisma.config.ts falls back to the `pnpm dev:setup`
// stack, which is local by construction.
if (!url) process.exit(0);

if (process.env.ALLOW_REMOTE_MIGRATE_DEV === "1") {
  console.warn(`⚠  ALLOW_REMOTE_MIGRATE_DEV=1 — running \`${COMMAND}\` against a non-local database.`);
  process.exit(0);
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error(`DATABASE_URL is not a parseable URL — refusing to run \`${COMMAND}\` against it.`);
  process.exit(1);
}

if (LOCAL_HOSTS.has(host)) process.exit(0);

console.error(
  [
    "",
    `Refusing to run \`${COMMAND}\` against a non-local database (host: ${host}).`,
    "",
    "This command rewrites or resets the database it is pointed at.",
    "It is for your local dev stack only.",
    "",
    "  • To apply already-committed migrations to a deployed database:",
    "        pnpm db:deploy",
    "",
    "  • To author a new migration: point DATABASE_URL at your local stack",
    "    (`pnpm dev:setup`), run `pnpm db:migrate`, then commit the generated",
    "    folder and ship it with `pnpm db:deploy`.",
    "",
    "  • If this really is a throwaway database, re-run with",
    "    ALLOW_REMOTE_MIGRATE_DEV=1.",
    "",
  ].join("\n"),
);
process.exit(1);
