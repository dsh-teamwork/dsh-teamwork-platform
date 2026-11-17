// The plugin's shared mode, unchanged, against the real server: the team host key becomes a host token bound to this
// identity, the client syncs the team with it as no person, and the same key on another identity is refused.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { BASE, KEY, TEAM, PLUGIN, BOB, BOB_TOKEN, EVE_TOKEN } = process.env;
const lib = (name) => import(pathToFileURL(join(PLUGIN, 'lib', name)).href);
const { SharedMode, sharedKeyPath } = await lib('shared-mode.js');
const { TeamworkClient } = await lib('client.js');
const { deviceIdentity, base64, SecureChannel, newChannelId } = await lib('secure-channel.js');
const { RelayLink } = await lib('relay.js');
const { PhoneKeys, PhoneSecurity } = await lib('phone-security.js');
const { SharedRoster } = await lib('shared-roster.js');
const { importAesKey } = await lib('aes-gcm.js');
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
let link;
const security = new PhoneSecurity({
  keys, scope: async () => 'shared', send: (f) => link.send(f), forward: (f) => forwarded.push(f),
  confirm: async (id) => { await link.request({ t: 'decide', pairingId: id, accept: true }); }, changed() {}, error() {},
  joining: (id) => joining.get(id),
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

// A member's handset: join, pin the DSH's key from the invite, and hand over the invite inside the channel.
async function handset(token, invite) {
  const deviceKey = randomBytes(32).toString('base64url');
  const res = await fetch(`${BASE}/relay/shared/${mode.status().hostId}/join`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-device-key': deviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ deviceName: 'phone' }) });
  assert.equal(res.status, 201);
  const { pairing } = await res.json();
  await until('the DSH to hear of the join', () => joining.has(pairing.id));
  const socket = new WebSocket(BASE.replace(/^http/, 'ws') + '/relay/phone');
  const frames = [], messages = [];
  let channel;
  socket.onmessage = (m) => { const f = JSON.parse(m.data); if (f.t === 'sealed') channel.receive(f); else frames.push(f); };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.send(JSON.stringify({ t: 'hello', token, deviceKey }));
  await until('welcome', () => frames.some((f) => f.t === 'welcome'));
  let ready = false;
  channel = new SecureChannel({ pairingId: pairing.id, channelId: newChannelId((n) => randomBytes(n)), identity: await deviceIdentity(base64(randomBytes(32))), initiator: true,
    importAesKey, expectedKey: dshKey, random: (n) => randomBytes(n), send: (f) => socket.send(JSON.stringify(f)),
    ready: () => { ready = true; }, message: (v) => messages.push(v), closed: () => {} });
  channel.start();
  await until('the pinned handshake', () => ready);
  channel.send({ t: 'shareJoin', invite: invite.id, secret: invite.secret, name: 'phone' });
  return { pairing, channel, messages, socket };
}

const bob = await handset(BOB_TOKEN, bobInvite);
await until('bob admitted', () => bob.messages.some((m) => m.t === 'pairAccepted'));
bob.channel.verified();
bob.channel.send({ t: 'call', pairingId: bob.pairing.id, id: '1', method: 'session/list', body: {} });
await until('bob\'s call reaching the bridge', () => forwarded.some((f) => f.t === 'call' && f.pairingId === bob.pairing.id));
assert.equal(await roster.memberOf(bob.pairing.id), BOB);

// Eve is listed but has no invite of her own: Bob's, already spent, admits nobody.
const eve = await handset(EVE_TOKEN, bobInvite);
await until('eve refused', () => eve.messages.some((m) => m.t === 'joinRefused'));
assert.equal(await roster.memberOf(eve.pairing.id), undefined);
for (const h of [bob, eve]) { h.channel.close(); h.socket.close(); }
link.stop();
console.log('shared mode ok');
