// The plugin's shared mode, unchanged, against the real server: the team host key becomes a host token bound to this
// identity, the client syncs the team with it as no person, and the same key on another identity is refused.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { BASE, KEY, TEAM, PLUGIN, BOB, BOB_TOKEN, EVE_TOKEN, ADMIN_COOKIE } = process.env;
const lib = (name) => import(pathToFileURL(join(PLUGIN, 'lib', name)).href);
const { SharedMode, sharedKeyPath } = await lib('shared-mode.js');
const { TeamworkClient } = await lib('client.js');
const { deviceIdentity, base64 } = await lib('secure-channel.js');
const { RelayLink } = await lib('relay.js');
const { PhoneKeys, PhoneSecurity } = await lib('phone-security.js');
const { SharedRoster } = await lib('shared-roster.js');
const { PinStore } = await lib('pin-lock.js');
const { AuditArchive } = await lib('audit-archive.js');
const { keygen, read } = await lib('audit-cli.js');
const { randomBytes } = await import('node:crypto');

const dir = await mkdtemp(join(tmpdir(), 'shared-e2e-'));
const cachePath = join(dir, 'teamwork-cache.json');
const client = new TeamworkClient(BASE, cachePath);
const seed = (fill) => base64(new Uint8Array(32).fill(fill));
const mode = new SharedMode({ path: sharedKeyPath(cachePath), server: () => client.endpoint, identity: () => deviceIdentity(seed(3)), onToken: (token) => client.useToken(token) });
await mode.enable(KEY);
mode.stop();
const snapshot = await client.sync();
assert.deepEqual(snapshot.teams.map((t) => [t.teamId, t.role]), [[TEAM, 'member']]);
assert.equal(mode.status().teamId, TEAM);

const other = new SharedMode({ path: join(dir, 'other.json'), server: () => client.endpoint, identity: () => deviceIdentity(seed(4)), onToken: async () => {} });
await assert.rejects(other.enable(KEY), (error) => error.code === 'elsewhere');

// The shared DSH on the relay, wired as the plugin wires it (src/index.ts): its roster admits a device by invite.
const until = async (what, check) => {
  for (let i = 0; i < 500; i++) { const value = check(); if (value) return value; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error(`timed out waiting for ${what}`);
};
const roster = new SharedRoster(join(dir, 'roster.json'));
const joining = new Map();
let members = [];
const forwarded = [];
const keys = new PhoneKeys(join(dir, 'phone-keys.json'));
// The admin's audit key, made on their own machine; the DSH gets only its public half.
const auditKeyFile = join(dir, 'audit-key.json');
const { publicKey: auditPublic } = await keygen(auditKeyFile);
const archive = new AuditArchive({
  path: join(dir, 'audit.json'), hostId: () => mode.status().hostId, identity: () => deviceIdentity(seed(3)),
  upload: async (body) => ({ status: (await fetch(`${BASE}/relay/shared/archive`, { method: 'POST', headers: { authorization: `Bearer ${client.platformCredential()}` }, body })).status }),
});
await archive.setKey(auditPublic);
let link;
const security = new PhoneSecurity({
  keys, scope: async () => 'shared', send: (f) => link.send(f),
  forward: (f) => {
    forwarded.push(f);
    void roster.memberOf(f.pairingId).then((m) => m && archive.record({ member: m, device: f.pairingId, dir: 'in', frame: f }));
    // A stand-in for the bridge: one session, which the client reads into its own shape.
    if (f.t === 'call' && f.method === 'session/list') security.send({ t: 'result', pairingId: f.pairingId, id: f.id, status: 200, body: { result: { ok: true, value: { items: [{ sessionId: 'session-1', cwd: '/home/bob/work', updatedAt: 1, projections: { values: { title: "Bob's" } } }] } } } });
  },
  confirm: async (id) => { await link.request({ t: 'decide', pairingId: id, accept: true }); }, changed() {}, error() {},
  joining: (id) => joining.get(id),
  pins: new PinStore(join(dir, 'pins.json')), pinMember: (id) => roster.memberOf(id),
  admit: async (i) => members.some((m) => m.userId === i.userId) && roster.accept({ inviteId: i.inviteId, secret: i.secret, userId: i.userId, pairingId: i.pairingId, deviceName: i.name }),
});
const readPairings = async () => { for (const p of await link.request({ t: 'pairings' })) if (p.status === 'pending') joining.set(p.id, p.userId); };
link = new RelayLink({
  endpoint: () => BASE, token: () => client.platformCredential(), clientIdPath: join(dir, 'cache.host.json'), name: 'box', dshVersion: 'e2e',
  onEvent: (e) => { if (e.t === 'members') members = e.members; else void readPairings(); },
  onForward: (f) => void security.handle(f),
});
link.refresh();
await until('the shared DSH on the relay', () => link.status === 'connected' && members.length === 3);
const bobInvite = await roster.invite({ userId: BOB, email: 'bob@example.test' });
const dshKey = await security.publicKey();

// A member's handset is the open relay client the web console and the phone app run (packages/relay-client), bundled
// for Node: it joins, pins the DSH's key from the invite, hands the invite over inside the channel, and sets its PIN.
const { build } = await import('esbuild');
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../packages/relay-client/src/index.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' });
const { createLiveRelay, RelayError } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function handset(token) {
  const identity = deviceIdentity(base64(randomBytes(32))), relayKey = randomBytes(32).toString('base64url'), peers = new Map();
  return createLiveRelay({
    keys: { identity: () => identity, relayKey: async () => relayKey, peer: async (id) => peers.get(id), trust: async (id, key) => { peers.set(id, key); }, forget: async (id) => { peers.delete(id); } },
    random: (n) => new Uint8Array(randomBytes(n)), session: async () => ({ server: BASE, token }), locale: () => 'en',
  });
}
const invite = (i) => ({ host: mode.status().hostId, key: dshKey, invite: i.id, secret: i.secret });

const bob = handset(BOB_TOKEN);
const [{ id: bobPairing }] = await Promise.all([bob.join(invite(bobInvite), 'phone'), until('the DSH to hear of the join', () => joining.size > 0)]);
let bobPin;
bob.watchPin(bobPairing, (state) => { bobPin = state; });
// Nothing reaches the DSH's sessions until Bob sets his PIN.
await until('bob asked for a PIN', () => bobPin?.kind === 'required' && bobPin.set);
await assert.rejects(bob.listSessions(bobPairing), (error) => error instanceof RelayError && error.code === 'locked');
assert.deepEqual(await bob.setPin(bobPairing, '2468'), { kind: 'unlocked' });
assert.deepEqual(await bob.listSessions(bobPairing), [{ id: 'session-1', title: 'Bob\'s', status: 'idle', updatedAt: new Date(1).toISOString(), directory: 'work', pending: null, step: null }]);
assert.ok(!forwarded.some((f) => f.t === 'call' && f.pairingId === bobPairing && f.method !== 'session/list'));

// What Bob sent is archived, the $events stream the listing opens and then the call: sealed here, kept by the server
// unopened, and read back with the admin's key alone.
await new Promise((r) => setTimeout(r, 20));
await archive.flush();
const exported = await fetch(`${BASE}/api/teams/${TEAM}/shared-archive/${mode.status().hostId}`, { headers: { cookie: ADMIN_COOKIE } });
assert.equal(exported.status, 200);
const text = await exported.text();
assert.ok(!text.includes('session/list') && !text.includes('$events'));
const { records, problems } = await read(text, JSON.parse(await readFile(auditKeyFile, 'utf8')));
assert.deepEqual(problems, []);
assert.deepEqual(records.map((r) => [r.member, r.frame.method ?? r.frame.body?.endpoint]), [[BOB, '$events'], [BOB, 'session/list']]);
assert.equal(await roster.memberOf(bobPairing), BOB);

// Eve is listed but has no invite of her own: Bob's, already spent, admits nobody.
const eve = handset(EVE_TOKEN);
await assert.rejects(eve.join(invite(bobInvite), 'phone'), (error) => error instanceof RelayError && error.code === 'invite_refused');
for (const h of [bob, eve]) h.reset();
link.stop();
console.log('shared mode ok');
