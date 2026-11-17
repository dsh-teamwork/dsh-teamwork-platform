// Copies the built console (apps/web/dist) into internal/web/dist, which
// the binary embeds. The server's build runs it, and turbo keeps the copy as
// that build's output (turbo.json); pack.mjs runs it too. Its generated files
// are not in git.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(server, '..', 'apps', 'web', 'dist');
const to = join(server, 'internal', 'web', 'dist');

if (!existsSync(join(from, 'index.html'))) {
  console.error('embed: apps/web/dist is missing; run `pnpm --filter @dsh-teamwork/web build` first');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
writeFileSync(join(to, '.gitkeep'), '');

const management = join(server, '..', 'apps', 'manage', 'dist');
if (!existsSync(join(management, 'index.html'))) throw new Error('Build @dsh-teamwork/manage first');
cpSync(management, join(server, 'manage', 'dist'), {recursive:true});
