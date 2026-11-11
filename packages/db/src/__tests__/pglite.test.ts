import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../index';

// What the in-process database promises (ADR 0006), on a directory of its own
// rather than the suites' shared memory database: it migrates itself, records
// each migration exactly as `prisma migrate deploy` would, and keeps what it
// wrote across a close and a reopen.
const directory = mkdtempSync(join(tmpdir(), 'dsh-teamwork-pglite-'));
const migrations = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
const committed = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function client() {
  process.env.PGLITE_DIR = directory;
  try {
    return createPrismaClient('');
  } finally {
    process.env.PGLITE_DIR = 'memory://';
  }
}

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('PGlite in a data directory', () => {
  it('applies every committed migration once, recorded with the checksum Prisma would write', async () => {
    const prisma = client();
    const rows = await prisma.$queryRaw<{ migration_name: string; checksum: string }[]>`
      SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    expect(rows.map((row) => row.migration_name)).toEqual(committed);
    for (const row of rows) {
      const sql = readFileSync(join(migrations, row.migration_name, 'migration.sql'));
      expect(row.checksum).toBe(createHash('sha256').update(sql).digest('hex'));
    }
    await prisma.user.create({ data: { authId: 'test:pglite', email: 'pglite@example.com' } });
    await prisma.$disconnect();
  });

  it('keeps its rows across a close and reopen, and migrates nothing twice', async () => {
    const prisma = client();
    expect(await prisma.user.findUnique({ where: { authId: 'test:pglite' } })).toMatchObject({ email: 'pglite@example.com' });
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM "_prisma_migrations"`;
    expect(count).toBe(committed.length);
    await prisma.$disconnect();
  });

  it('lets a script exit once it disconnects, which closes PGlite', () => {
    // An open PGlite keeps the event loop alive, so a seed or a one-off script
    // would hang here forever if `$disconnect()` did not close it.
    const script = `
      const db = await import('./src/index.ts');
      const { createPrismaClient } = db.createPrismaClient ? db : db.default;
      const prisma = createPrismaClient('');
      await prisma.user.count();
      await prisma.$disconnect();
    `;
    const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: join(import.meta.dirname, '..', '..'),
      env: { ...process.env, PGLITE_DIR: directory },
      timeout: 60_000,
    });
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
  }, 70_000);
});
