// Copies the built console into the Go server, which embeds it
// (server/internal/web). The directory's .gitkeep stays; everything else is
// replaced.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'dist');
const to = join(here, '..', '..', '..', 'server', 'internal', 'web', 'dist');

mkdirSync(to, { recursive: true });
for (const entry of readdirSync(to)) if (entry !== '.gitkeep') rmSync(join(to, entry), { recursive: true, force: true });
if (!existsSync(join(from, 'index.html'))) throw new Error('dist/index.html is missing: run vite build first');
cpSync(from, to, { recursive: true });
console.log(`console embedded into ${to}`);
