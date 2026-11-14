// The npx smoke test (docs/tech/go-server.md, phase 4): publishes the
// tarballs `pack.mjs` wrote to a scratch registry, then starts the server the
// way a person does, with `npx` from an empty cache, and checks it serves.
//
//   node scripts/smoke-npm.mjs <registry-url> <tarball-dir> <version>
//
// The registry is one nobody else uses (CI starts Verdaccio on the runner),
// and must accept the platform packages' size (about 11 MB).
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [registry, tarballs, version] = process.argv.slice(2);
if (!registry || !tarballs || !version) {
  console.error('usage: node scripts/smoke-npm.mjs <registry-url> <tarball-dir> <version>');
  process.exit(1);
}

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'));
const npmrc = join(home, '.npmrc');
writeFileSync(npmrc, `registry=${registry}\n//${new URL(registry).host}/:_authToken=smoke\n`);
const env = { ...process.env, npm_config_userconfig: npmrc, npm_config_cache: join(home, 'cache') };
const windows = process.platform === 'win32';
const npm = (args, opts = {}) => execFileSync(windows ? 'npm.cmd' : 'npm', args, { env, shell: windows, encoding: 'utf8', ...opts });
const npx = (args) => [windows ? 'npx.cmd' : 'npx', ['--yes', `@dsh-teamwork/server@${version}`, ...args]];

// The platform packages first, so the launcher's dependencies resolve.
const launcher = `dsh-teamwork-server-${version}.tgz`;
const files = readdirSync(tarballs).filter((f) => f.endsWith('.tgz'));
files.sort((a, b) => Number(a === launcher) - Number(b === launcher));
for (const file of files) npm(['publish', join(tarballs, file), '--access', 'public', '--tag', 'smoke'], { stdio: 'inherit' });

const [cmd, args] = npx(['--version']);
const printed = execFileSync(cmd, args, { env, shell: windows, encoding: 'utf8', cwd: home }).trim();
console.log(`--version: ${printed}`);
if (printed !== `dsh-teamwork ${version}`) throw new Error(`expected "dsh-teamwork ${version}"`);

// Start it on a port of its own and wait for the home page.
const port = 3990;
const [serveCmd, serveArgs] = npx(['--data', join(home, 'data'), '--port', String(port)]);
const child = spawn(serveCmd, serveArgs, { env, shell: windows, cwd: home, stdio: 'inherit', detached: !windows });
let served = false;
for (let i = 0; i < 60 && !served; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  served = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.status === 200, () => false);
}
const health = served && (await fetch(`http://127.0.0.1:${port}/robots.txt`)).status;

// npm does not pass a signal on, so the whole tree is stopped.
if (windows) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
else process.kill(-child.pid, 'SIGTERM');

if (!served || health !== 200) {
  console.error(`smoke: the server did not serve on ${port} (home ${served}, robots.txt ${health})`);
  process.exit(1);
}
console.log('smoke: installed with npx, started, and served');
