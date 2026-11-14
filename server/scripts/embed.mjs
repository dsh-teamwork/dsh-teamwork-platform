// Copies the built console (apps/console/dist) into internal/web/dist, which
// the binary embeds. The server's build runs it, and turbo keeps the copy as
// that build's output (turbo.json); pack.mjs runs it too. The directory is not
// in git.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(server, '..', 'apps', 'console', 'dist');
const to = join(server, 'internal', 'web', 'dist');

if (!existsSync(join(from, 'index.html'))) {
  console.error('embed: apps/console/dist is missing; run `pnpm --filter @dsh-teamwork/console build` first');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
