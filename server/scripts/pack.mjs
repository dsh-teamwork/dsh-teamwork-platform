// Builds the release: one binary per platform, the npm packages around them,
// and their tarballs, all under dist/release (ADR 0014; docs/tech/go-server.md,
// "Rules for packaging").
//
//   node scripts/pack.mjs <version>
//
// The console must be built first (`pnpm --filter @dsh-teamwork/console build`),
// since every binary embeds it. Packing happens here, beside the build, because
// a binary carried between jobs as a workflow artifact loses its executable
// bit; the modes in each tarball are checked before anything is published.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = [
  { os: 'linux', cpu: 'x64', goos: 'linux', goarch: 'amd64' },
  { os: 'linux', cpu: 'arm64', goos: 'linux', goarch: 'arm64' },
  { os: 'darwin', cpu: 'x64', goos: 'darwin', goarch: 'amd64' },
  { os: 'darwin', cpu: 'arm64', goos: 'darwin', goarch: 'arm64' },
  { os: 'win32', cpu: 'x64', goos: 'windows', goarch: 'amd64' },
];

const version = process.argv[2]?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: node scripts/pack.mjs <version>   (for example 0.1.0)');
  process.exit(1);
}

const server = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('node', [join(server, 'scripts/embed.mjs')], { stdio: 'inherit' });

const out = join(server, 'dist/release');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'binaries'), { recursive: true });

const common = {
  version,
  description: 'DSH Teamwork server: team models, presets and plugins for DeepSeek Harness',
  license: 'Apache-2.0',
  repository: { type: 'git', url: 'https://github.com/dsh-teamwork/dsh-teamwork-platform' },
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const packages = [];
for (const t of TARGETS) {
  const name = `server-${t.os}-${t.cpu}`;
  const exe = t.os === 'win32' ? 'dsh-teamwork.exe' : 'dsh-teamwork';
  const dir = join(out, 'npm', name);
  const binary = join(dir, 'bin', exe);
  execFileSync(
    'go',
    ['build', '-trimpath', '-ldflags', `-s -w -X main.version=${version}`, '-o', binary, './cmd/dsh-teamwork'],
    { cwd: server, stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOOS: t.goos, GOARCH: t.goarch } },
  );
  chmodSync(binary, 0o755);
  writeFileSync(
    join(dir, 'package.json'),
    json({ name: `@dsh-teamwork/${name}`, ...common, os: [t.os], cpu: [t.cpu], files: ['bin'], preferUnplugged: true }),
  );
  // The same binary as a release download, named for its platform.
  copyFileSync(binary, join(out, 'binaries', `dsh-teamwork-${version}-${t.os}-${t.cpu}${t.os === 'win32' ? '.exe' : ''}`));
  packages.push({ dir, exe: t.os === 'win32' ? null : `bin/${exe}` });
}

const launcher = join(out, 'npm/server');
mkdirSync(join(launcher, 'bin'), { recursive: true });
copyFileSync(join(server, 'npm/launcher.js'), join(launcher, 'bin/launcher.js'));
chmodSync(join(launcher, 'bin/launcher.js'), 0o755);
writeFileSync(
  join(launcher, 'package.json'),
  json({
    name: '@dsh-teamwork/server',
    ...common,
    bin: { 'dsh-teamwork': 'bin/launcher.js' },
    files: ['bin'],
    engines: { node: '>=18' },
    optionalDependencies: Object.fromEntries(TARGETS.map((t) => [`@dsh-teamwork/server-${t.os}-${t.cpu}`, version])),
  }),
);
packages.push({ dir: launcher, exe: 'bin/launcher.js' });

// Pack each one, and refuse a Unix binary that lost its executable bit.
for (const p of packages) {
  const [report] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', out], { cwd: p.dir, encoding: 'utf8' }));
  if (p.exe) {
    const file = report.files.find((f) => f.path === p.exe);
    if (!file || (file.mode & 0o111) === 0) {
      console.error(`pack: ${report.filename} holds ${p.exe} without its executable bit`);
      process.exit(1);
    }
  }
  console.log(`${report.filename}  ${(report.size / 1e6).toFixed(1)} MB`);
}
