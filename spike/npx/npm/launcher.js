#!/usr/bin/env node
// Runs the binary from the platform package npm installed beside this one.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const target = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'dsh-teamwork.exe' : 'dsh-teamwork';
let binary;
try {
  binary = require.resolve(`@dsh-teamwork-exp/server-${target}/bin/${exe}`);
} catch {
  console.error(`dsh-teamwork: no binary for ${target}. Supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64.`);
  console.error('If optional dependencies were skipped (--omit=optional, --no-optional), install again without that flag.');
  process.exit(1);
}

// Windows starts a program only from a path shorter than MAX_PATH (260), and
// `pnpm dlx` or a long user name can put the package deeper than that. Run a
// copy kept under a short per-version directory instead.
if (process.platform === 'win32' && binary.length >= 260) {
  const { version } = require('../package.json');
  const short = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'dsh-teamwork', version, exe);
  if (!fs.existsSync(short) || fs.statSync(short).size !== fs.statSync(binary).size) {
    fs.mkdirSync(path.dirname(short), { recursive: true });
    fs.copyFileSync(binary, `${short}.tmp`);
    fs.renameSync(`${short}.tmp`, short);
  }
  binary = short;
}

const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(`dsh-teamwork: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
