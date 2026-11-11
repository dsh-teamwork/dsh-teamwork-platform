/**
 * Fail if the schema (`prisma/schema/`) describes anything the migrations cannot build.
 *
 * This check exists because its absence cost the project its ability to
 * rebuild its own database. Three enums, two tables, eight columns and a dozen
 * indexes — the Daily, pack sharing, the Plus split, the generation ledger,
 * the ad-grant ledger — reached the deployed database through `prisma db push`
 * and never through a migration. Nothing noticed: 1,000+ tests passed, CI was
 * green, and production worked, because production had been pushed to. Only a
 * fresh `prisma migrate deploy` revealed it, and nothing in the repo ever ran
 * one.
 *
 * The check is one question: **replay every migration into an empty database
 * and compare the result to the schema.** Empty diff, or this exits non-zero.
 *
 * It needs a throwaway database to replay into, which is why it runs where one
 * exists — CI's Postgres service, or `pnpm dev:setup` locally — and skips with
 * a warning rather than a failure where one does not. A check that fails for
 * the wrong reason on a laptop is a check people learn to ignore.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { config } from 'dotenv';

// The same file list, in the same order, as prisma.config.ts and
// assert-local-database.mjs. Without it this guard read only the real
// environment, so a developer who set the repo up exactly as documented —
// `pnpm dev:setup`, then a packages/db/.env — still got "skipped", and the
// pre-push hook's drift step was quietly off for everyone.
//
// `override: false` throughout, so CI and a deployed environment keep beating
// every file.
for (const file of ['.env', '../../.env', '../../apps/web/.env']) {
  config({ path: path.resolve(process.cwd(), file), override: false, quiet: true });
}

const SHADOW = process.env.SHADOW_DATABASE_URL ?? process.env.DRIFT_SHADOW_DATABASE_URL;

if (!SHADOW) {
  console.warn(
    '[db:drift] skipped — no SHADOW_DATABASE_URL to replay migrations into.\n' +
      '           Run `pnpm dev:setup`, then put this in packages/db/.env:\n' +
      '           SHADOW_DATABASE_URL=postgresql://postgres:postgres_password@localhost:5432/prisma_shadow',
  );
  process.exit(0);
}

const result = spawnSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    './prisma/migrations',
    '--to-schema',
    './prisma/schema',
    // 0 = no difference, 2 = a difference, 1 = the command itself failed.
    '--exit-code',
  ],
  { stdio: 'inherit', env: { ...process.env, SHADOW_DATABASE_URL: SHADOW } },
);

if (result.status === 0) {
  console.log('[db:drift] migrations build the schema exactly. ✓');
  process.exit(0);
}

if (result.status === 2) {
  console.error(
    '\n[db:drift] the schema describes objects no migration creates.\n' +
      '\n' +
      'Everything above exists in the schema and would be MISSING from a database\n' +
      'built by `pnpm db:deploy` — which is how production is built. Left here, the\n' +
      'code will query columns a fresh deploy does not have.\n' +
      '\n' +
      'Fix: author the migration, do not push it.\n' +
      '  pnpm db:migrate --name <what_changed>\n' +
      '\n' +
      'If the deployed database already has these objects (someone ran db:push),\n' +
      'the migration has to be idempotent so it is a no-op there — see\n' +
      'the idempotency rule in CLAUDE.md for the shape.',
  );
  process.exit(1);
}

console.error('[db:drift] could not compare — see the error above.');
process.exit(result.status ?? 1);
