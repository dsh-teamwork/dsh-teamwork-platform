// The DSH plugin's own relay client and native Web connector, unchanged, in
// front of a stand-in for DSH's loopback Web server (docs/tech/relay.md,
// "Native Web on a personal computer"). web_test.go plays the browser and
// starts the server; this script is the computer. It prints one JSON line,
// {"host": "<hostId>"}, each time the link connects, reconnects when it reads
// "reconnect" on stdin, and stops when stdin ends.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const { BASE, TOKEN, PLUGIN } = process.env;
const { RelayLink } = await import(pathToFileURL(join(PLUGIN, 'lib/relay.js')).href);
const { connectWebRelay } = await import(pathToFileURL(join(PLUGIN, 'lib/web-relay.js')).href);
const { WebSocketServer } = createRequire(join(PLUGIN, 'package.json'))('ws');

// DSH's Web: the launch URL signs a page in with a cookie, and every other
// request needs that cookie and DSH's own Host, as DSH checks them.
const LAUNCH_TOKEN = 'launch-secret';
let authority = '';
const seen = (req) => ({
  method: req.method, url: req.url, host: req.headers.host ?? '', cookie: req.headers.cookie ?? '',
  origin: req.headers.origin ?? '', authorization: req.headers.authorization ?? '', referer: req.headers.referer ?? '',
});
const signedIn = (req) => req.headers.cookie === 'dsh=local' && req.headers.host === authority;
const dsh = createServer((req, res) => {
  if (req.method === 'GET' && req.url === `/?token=${LAUNCH_TOKEN}`) {
    res.writeHead(303, { location: '/', 'set-cookie': 'dsh=local; Path=/; HttpOnly' }).end();
    return;
  }
  if (!signedIn(req)) {
    res.writeHead(401).end();
    return;
  }
  if (req.url.startsWith('/echo')) {
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'leak=1' }).end(JSON.stringify(seen(req)));
    return;
  }
  if (req.method === 'POST' && req.url === '/upload') {
    // A DSH that reads an upload slowly: the tunnel must hold the browser back, not drop it.
    const hash = createHash('sha256');
    let bytes = 0;
    req.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
      req.pause();
      setTimeout(() => req.resume(), 1);
    });
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ bytes, sha256: hash.digest('hex') })));
    return;
  }
  if (req.url === '/eof') {
    // A body that ends only when DSH closes the connection.
    req.socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${'x'.repeat(200_000)}`);
    return;
  }
  res.writeHead(404).end();
});
const sockets = new WebSocketServer({ noServer: true });
dsh.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/remote.mux' || !signedIn(req) || req.headers.origin !== `http://${authority}`) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify(seen(req)));
    ws.on('message', (data, binary) => ws.send(data, { binary }));
  });
});
await new Promise((resolve) => dsh.listen(0, '127.0.0.1', resolve));
authority = `127.0.0.1:${dsh.address().port}`;
const launch = `http://${authority}/?token=${LAUNCH_TOKEN}`;

// The plugin wires the same two options in src/index.ts.
let connections = 0;
const link = new RelayLink({
  endpoint: () => BASE, token: () => TOKEN,
  clientIdPath: join(mkdtempSync(join(tmpdir(), 'web-e2e-')), 'cache.host.json'),
  name: 'e2e desktop', dshVersion: 'e2e',
  webAvailable: async () => true,
  onWebDial: (url, id, lifetime) => {
    connectWebRelay(launch, url, id, lifetime).catch((error) => console.error('web dial failed:', error));
  },
  onStatus: (status) => {
    if (status !== 'connected') return;
    connections++;
    console.log(JSON.stringify({ host: link.host }));
  },
});
link.refresh();

for await (const line of createInterface({ input: process.stdin })) {
  assert.equal(line, 'reconnect');
  link.refresh();
}
link.stop();
sockets.close();
dsh.closeAllConnections();
dsh.close();
assert.ok(connections >= 2, 'the link never reconnected');
