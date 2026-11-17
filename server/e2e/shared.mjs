// The plugin's shared mode, unchanged, against the real server: the team host key becomes a host token bound to this
// identity, the client syncs the team with it as no person, and the same key on another identity is refused.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { BASE, KEY, TEAM, PLUGIN } = process.env;
const lib = (name) => import(pathToFileURL(join(PLUGIN, 'lib', name)).href);
const { SharedMode, sharedKeyPath } = await lib('shared-mode.js');
const { TeamworkClient } = await lib('client.js');
const { deviceIdentity, base64 } = await lib('secure-channel.js');

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
console.log('shared mode ok');
