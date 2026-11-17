import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const listed = spawnSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], { encoding: 'utf8' });
if (listed.error) throw listed.error;
if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exit(listed.status ?? 1);
}

const servers = JSON.parse(listed.stdout).flatMap(({ name, path }) => {
  if (!existsSync(join(path, 'go.mod'))) return [];
  const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  return manifest.scripts?.dev ? [{ name, manifest }] : [];
});
const composed = new Set(servers.flatMap(({ manifest }) => Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
})));
const selected = servers.filter(({ name }) => !composed.has(name));
if (selected.length !== 1) {
  throw new Error(`Expected one outermost Go development server, found: ${selected.map(({ name }) => name).join(', ') || 'none'}`);
}

const result = spawnSync('pnpm', [
  'exec', 'turbo', 'run', 'dev',
  '--filter=@dsh-teamwork/web',
  `--filter=${selected[0].name}`,
], {
  stdio: 'inherit',
  env: { ...process.env, APP_URL: process.env.APP_URL || 'http://localhost:3800' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
