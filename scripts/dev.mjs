// `pnpm dev`: the edition's Go server on :3800, the one address a browser
// opens, and the two Vite servers it takes pages from (DEV_VITE): the web app
// on :3810 and the management console, served at /manage, on :3811.
//
// The edition is whatever this workspace holds. Its Go server is the one no
// other Go server depends on (premium/server over server/); its web app is the
// one no other web app depends on (premium/apps/web over apps/web). The
// management console here is always the open one, as the combined role mounts
// it; the closed operator console runs on its own (premium/CLAUDE.md).
//
// A `.env` at the repository root (gitignored) is read first, so a local
// SMTP_URL or ADMIN_EMAILS need not be typed on every start; a variable the
// shell already sets wins over the file. It is read once: an edit takes a
// restart of `pnpm dev`.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const listed = spawnSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], { encoding: 'utf8' });
if (listed.error) throw listed.error;
if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exit(listed.status ?? 1);
}

const packages = JSON.parse(listed.stdout).map(({ name, path }) => {
  const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  return { name, go: existsSync(join(path, 'go.mod')), uses: new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) };
});
const outermost = (set) => {
  const found = set.filter((p) => !set.some((other) => other.uses.has(p.name)));
  if (found.length !== 1) throw new Error(`Expected one outermost of ${set.map((p) => p.name).join(', ')}; found ${found.map((p) => p.name).join(', ') || 'none'}`);
  return found[0].name;
};
const server = outermost(packages.filter((p) => p.go));
const web = outermost(packages.filter((p) => p.name === '@dsh-teamwork/web' || p.uses.has('@dsh-teamwork/web') && !p.go));

const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'dev', `--filter=${server}`, `--filter=${web}`, '--filter=@dsh-teamwork/manage'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
