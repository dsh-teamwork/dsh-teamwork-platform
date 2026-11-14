// The DSH plugin, unchanged, against a running Go server: the plugin's own
// TeamworkClient and loopback listener (../dsh-teamwork, or $DSH_TEAMWORK_PLUGIN)
// sign in, sync and call a model, with this script standing in for the
// person's browser. Run by e2e_test.go, which starts the server and a stub
// provider; see docs/tech/go-server.md, phase 1.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { BASE, SETUP_TOKEN, STUB_URL, PLUGIN } = process.env;
const { TeamworkClient } = await import(join(PLUGIN, 'lib/client.js'));
const { listenForCode } = await import(join(PLUGIN, 'lib/login-callback.js'));

// The browser: the site's own Origin, and the session cookie it was given.
let cookie = '';
async function browser(path, body) {
  const response = await fetch(`${BASE}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// The admin claims the instance and sets a team up.
await browser('auth/setup', { token: SETUP_TOKEN, email: 'admin@example.com', password: 'correct horse battery' });
const team = await browser('teams', { name: 'Core' });
await browser(`teams/${team.id}/providers`, { name: 'stub', baseUrl: STUB_URL, apiKey: 'sk-e2e' });
const model = await browser(`teams/${team.id}/configs`, { kind: 'model', name: 'Stub', data: { provider: 'stub', model: 'stub-model', maxTokens: 512 } });

// `/teamwork login`: the plugin listens on loopback and prints /plugin?…
const client = new TeamworkClient(BASE, join(mkdtempSync(join(tmpdir(), 'dsh-e2e-')), 'cache.json'));
let redeemed;
const signedIn = new Promise((resolve, reject) => (redeemed = { resolve, reject }));
const callback = await listenForCode(async (code) => {
  try {
    await client.completeLogin(code);
    redeemed.resolve();
  } catch (error) {
    redeemed.reject(error);
    throw error;
  }
});
const link = new URL(client.beginLogin(callback.uri));
assert.equal(link.pathname, '/plugin');

// The person presses Authorize; the browser follows the code back to the plugin.
const minted = await browser('auth/plugin/code', { challenge: link.searchParams.get('challenge'), redirectUri: link.searchParams.get('redirect_uri') });
assert.equal(minted.returnTo?.to, 'dsh');
const back = new URL(minted.returnTo.url);
back.searchParams.set('code', minted.code);
const landed = await fetch(back);
assert.equal(landed.status, 200, 'the loopback listener took the code');
await signedIn;
assert.ok(client.authenticated());

// `/teamwork sync`: parsed by the plugin's own snapshot schema.
const snapshot = await client.sync();
assert.equal(snapshot.teams.length, 1);
assert.equal(snapshot.teams[0].teamId, team.id);
assert.deepEqual(snapshot.teams[0].configs.map((c) => c.id), [model.id]);

// A team model, called the way DSH calls it through the plugin.
const call = (stream) =>
  fetch(`${client.endpoint}/api/llm/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.platformCredential()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.id, messages: [{ role: 'user', content: 'hi' }], stream }),
  });
const plain = await call(false);
assert.equal(plain.status, 200);
assert.equal((await plain.json()).choices[0].message.content, 'hello');
const streamed = await call(true);
assert.equal(streamed.headers.get('content-type'), 'text/event-stream');
const text = await streamed.text();
assert.ok(text.trim().endsWith('data: [DONE]'), text);

callback.close();
console.log(`plugin e2e ok: signed in, synced ${snapshot.teams[0].configs.length} configuration, two calls through the gateway`);
