#!/usr/bin/env node
// The `bin` of @dsh-teamwork/server: runs the binary from the platform package
// npm installed beside it (ADR 0014; docs/tech/go-server.md, "Rules for
// packaging"). A service runs that binary itself, never this launcher through
// npx: npm does not pass a SIGTERM on.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SUPPORTED = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
const target = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'dsh-teamwork.exe' : 'dsh-teamwork';

let binary;
try {
  binary = require.resolve(`@dsh-teamwork/server-${target}/bin/${exe}`);
} catch {
  console.error(`dsh-teamwork: no binary for ${target}. Supported: ${SUPPORTED.join(', ')}.`);
  console.error('If optional dependencies were skipped (--omit=optional, --no-optional), install again without that flag.');
  process.exit(1);
}

// Windows cannot start a program whose path is 260 characters or longer, and
// `pnpm dlx` or a long user name reaches that. Such a binary runs from a copy
// under %LOCALAPPDATA%, one per version, written once.
if (process.platform === 'win32' && binary.length >= 260) {
  const { version } = require('../package.json');
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const short = path.join(base, 'dsh-teamwork', version, exe);
  if (!fs.existsSync(short) || fs.statSync(short).size !== fs.statSync(binary).size) {
    fs.mkdirSync(path.dirname(short), { recursive: true });
    const partial = `${short}.${process.pid}`;
    fs.copyFileSync(binary, partial);
    fs.renameSync(partial, short);
  }
  binary = short;
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(`dsh-teamwork: ${error.message}`);
  process.exit(1);
});
// Ended by a signal, the launcher ends by the same one, so whoever started it
// sees why; its own handlers go first, or they would catch it.
child.on('exit', (code, signal) => {
  if (!signal) process.exit(code ?? 1);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeAllListeners(s);
  process.kill(process.pid, signal);
});
