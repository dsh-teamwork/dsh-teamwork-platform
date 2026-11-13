#!/usr/bin/env node
// Runs the binary from the platform package npm installed beside this one.
'use strict';
const { spawn } = require('node:child_process');
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
const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(`dsh-teamwork: ${error.message}`); process.exit(1); });
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
