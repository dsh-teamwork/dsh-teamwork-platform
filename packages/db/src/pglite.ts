/**
 * PGlite: Postgres compiled to WebAssembly and run inside this process — the
 * database when no DATABASE_URL is set (ADR 0006).
 *
 * It is the same dialect, so the schema and the committed migrations serve it
 * unchanged. The Prisma CLI cannot reach a database inside another process,
 * so the migrations are applied here, on first connect, recorded in
 * `_prisma_migrations` the way `prisma migrate deploy` records them. A dump of
 * a PGlite database restored into Postgres therefore takes later migrations
 * from `pnpm db:deploy` as usual.
 *
 * One PGlite per directory per process: PGlite is single-connection, and two
 * instances over one directory would corrupt it. Two processes over one
 * directory are not prevented here; the server is one process.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PrismaPGlite } from 'pglite-prisma-adapter';

import type { Prisma } from './generated/prisma/index.js';

/** Where the data lives: `PGLITE_DIR`, `memory://` for a throwaway database, or `~/.dsh-teamwork/db`. */
function pgliteDirectory(): string {
  return process.env.PGLITE_DIR || join(homedir(), '.dsh-teamwork', 'db');
}

/** The committed migrations, which `prisma/schema/schema.prisma` names as its own. */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

type Open = { db: PGlite; ready: Promise<void> };
const open = new Map<string, Open>();

function openPglite(directory: string): Open {
  const existing = open.get(directory);
  if (existing) return existing;
  if (!directory.startsWith('memory://')) mkdirSync(dirname(directory), { recursive: true });
  const db = new PGlite(directory, { extensions: { pgcrypto } });
  const entry = { db, ready: db.waitReady.then(() => migrate(db)) };
  open.set(directory, entry);
  return entry;
}

/** Applies every committed migration not yet recorded, each in its own transaction. */
async function migrate(db: PGlite): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const { rows } = await db.query<{ migration_name: string }>(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const done = new Set(rows.map((row) => row.migration_name));
  const pending = readdirSync(MIGRATIONS)
    .filter((name) => !done.has(name) && existsSync(join(MIGRATIONS, name, 'migration.sql')))
    .sort();
  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), 1)',
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), name],
      );
    });
  }
}

type Adapter = Awaited<ReturnType<PrismaPGlite['connect']>>;

/**
 * A driver adapter over the process's PGlite for `directory`.
 *
 * Nothing opens until Prisma first connects: `next build` imports the client
 * while it collects page data, and must not create a data directory or run
 * migrations on the build machine. A connection waits for the migrations, and
 * its `dispose` — which `PrismaClient.$disconnect()` calls — closes PGlite,
 * without which a script would never exit. The next connection reopens it.
 */
export function pgliteAdapter(directory = pgliteDirectory()): NonNullable<Prisma.PrismaClientOptions['adapter']> {
  const connect = async (): Promise<Adapter> => {
    const { db, ready } = openPglite(directory);
    await ready;
    const adapter = await new PrismaPGlite(db).connect();
    const dispose = async () => {
      if (open.get(directory)?.db !== db) return;
      open.delete(directory);
      await db.close();
    };
    return Object.assign(Object.create(adapter) as Adapter, { dispose });
  };
  return { provider: 'postgres', adapterName: 'pglite-prisma-adapter', connect };
}
