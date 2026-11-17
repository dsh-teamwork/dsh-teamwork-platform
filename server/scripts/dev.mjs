// `pnpm dev`'s Go server: the edition's binary run with `go run`, restarted
// when a Go source, SQL migration or embedded JSON file changes in this module
// or a module its go.mod replaces with a local path. It runs from the module's
// own directory (server/ or premium/server/).
import { spawn } from 'node:child_process';
import { readFileSync, watch } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const replacements = [...readFileSync('go.mod', 'utf8').matchAll(/^\s*replace\s+[^=\n]+=>\s+(\S+)/gm)]
  .map((match) => match[1])
  .filter((path) => path.startsWith('.') || isAbsolute(path))
  .map((path) => resolve(path));
const roots = [...new Set([process.cwd(), ...replacements])];
const source = /\.(?:go|sql|json|mod|sum)$/;
const ignored = /(?:^|[\\/])(?:dist|node_modules|\.turbo)(?:[\\/]|$)/;

let child = null;
let timer = null;
let restarting = false;
let again = false;
let closing = false;

function signal(processHandle, name) {
  try {
    if (process.platform !== 'win32' && processHandle.pid) process.kill(-processHandle.pid, name);
    else processHandle.kill(name);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error);
  }
}

async function stop() {
  const current = child;
  if (!current) return;
  child = null;
  if (current.exitCode !== null || current.signalCode !== null) {
    signal(current, 'SIGTERM');
    return;
  }
  await new Promise((resolveStop) => {
    const force = setTimeout(() => {
      signal(current, 'SIGKILL');
      resolveStop();
    }, 2000);
    current.once('exit', () => {
      clearTimeout(force);
      resolveStop();
    });
    signal(current, 'SIGTERM');
  });
}

function start() {
  if (closing) return;
  const current = spawn('go', ['run', './cmd/dsh-teamwork'], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    // The pages come from the Vite servers (DEV_VITE): the browser opens
    // this server alone, on :3800 as in production.
    env: { ...process.env, DEV_VITE: '1' },
  });
  child = current;
  current.on('error', (error) => {
    console.error(`Could not start Go server: ${error.message}`);
    if (child === current) child = null;
  });
}

async function restart() {
  if (closing) return;
  if (restarting) {
    again = true;
    return;
  }
  restarting = true;
  do {
    again = false;
    console.log('Restarting Go server...');
    await stop();
    start();
  } while (again && !closing);
  restarting = false;
}

function changed(filename) {
  if (filename) {
    const path = String(filename);
    if (!source.test(path) || ignored.test(path)) return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => void restart(), 200);
}

const watchers = roots.map((root) => watch(root, { recursive: true }, (_event, filename) => changed(filename)));

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  await stop();
  process.exitCode = code;
}

for (const watcher of watchers) watcher.on('error', (error) => {
  console.error(error);
  void shutdown(1);
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

start();
