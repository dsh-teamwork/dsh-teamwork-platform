// The Go side of `pnpm db:drift`: replays each dialect's migrations into a
// scratch database and fails when the schema holds a change no migration does.
// It needs a Postgres and a MySQL database it may empty (MIGRATE_DEV_POSTGRES,
// MIGRATE_DEV_MYSQL); without them it skips with a warning. CI sets both.
import { execFileSync } from 'node:child_process';

if (!process.env.MIGRATE_DEV_POSTGRES || !process.env.MIGRATE_DEV_MYSQL) {
  console.warn('db:drift (Go) skipped: set MIGRATE_DEV_POSTGRES and MIGRATE_DEV_MYSQL to check the migrations');
  process.exit(0);
}
execFileSync('go', ['run', './internal/db/cmd/migrations', 'check'], { stdio: 'inherit' });
