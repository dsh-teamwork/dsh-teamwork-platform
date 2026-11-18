// The DSH plugin's own relay client, unchanged, against the server's
// relay, with this script standing in for the phone the way the app talks to
// it: discover, pair, confirm on the computer, pass a call through, revoke.
// Run by relay_test.go, which starts the server.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { BASE, TOKEN, PLUGIN } = process.env;
const { RelayLink } = await import(pathToFileURL(join(PLUGIN, 'lib/relay.js')).href);

const until = async (what, check) => {
  for (let i = 0; i < 300; i++) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

// One canonical wire implementation, executed by both endpoints.
const { SecureChannel, deviceIdentity, base64, newChannelId } = await import(pathToFileURL(join(PLUGIN,'lib/secure-channel.js')).href);
const { randomBytes } = await import('node:crypto');
// The phone side runs the plugin's own channel and AES-GCM records. The
// clients' copy (packages/relay-client) must be this one, byte for byte.
assert.equal(readFileSync(new URL('../../packages/relay-client/src/secure-channel.ts', import.meta.url), 'utf8'), readFileSync(join(PLUGIN, 'src/secure-channel.ts'), 'utf8'));
const { importAesKey: desktopAes } = await import(pathToFileURL(join(PLUGIN, 'lib/aes-gcm.js')).href);
const mobileAes = desktopAes;
const zeroKey = await mobileAes(new Uint8Array(32));
const vector = await zeroKey.encrypt(new Uint8Array(16), new Uint8Array(12), new Uint8Array(0));
assert.equal(Buffer.from(vector).toString('hex'), 'cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919');
assert.deepEqual(await (await desktopAes(new Uint8Array(32))).decrypt(vector, new Uint8Array(12), new Uint8Array(0)), new Uint8Array(16));
await assert.rejects(zeroKey.decrypt(vector, new Uint8Array(12), new Uint8Array([1])));
const phoneIdentity = await deviceIdentity(base64(randomBytes(32)));
const hostIdentity = await deviceIdentity(base64(randomBytes(32)));
const events = [], wire = [], business = [], codes = [];
let hostChannel;
let link;
link = new RelayLink({
  endpoint: () => BASE, token: () => TOKEN,
  clientIdPath: join(mkdtempSync(join(tmpdir(),'relay-e2e-')),'cache.host.json'),
  name:'e2e laptop',dshVersion:'e2e',onEvent:event=>events.push(event),
  onForward:frame=>{
    if(frame.t!=='sealed')return;
    wire.push(frame);
    if(!hostChannel){
      hostChannel=new SecureChannel({pairingId:frame.pairingId,channelId:frame.channelId,identity:hostIdentity,initiator:false,importAesKey:desktopAes,
        expectedKey:phoneIdentity.publicKey,random:n=>randomBytes(n),send:f=>{wire.push(f);link.send(f);},
        ready:(_key,code)=>codes.push(code),message:value=>{business.push(value);hostChannel.send({echoed:value.method,blob:value.blob});},closed:()=>{}});
      hostChannel.start();
    }
    hostChannel.receive(frame);
  },
});
link.refresh();
await until('the link to connect', () => link.status === 'connected');
assert.ok(link.host);

// The phone finds the relay as the app does: from the plugin socket's address.
const { url } = await (await fetch(`${BASE}/api/relay`)).json();
const origin = url.replace(/^ws/, 'http').replace(/\/plugin$/, '');
const deviceKey = randomBytes(32).toString('base64url');
const otherDeviceKey = randomBytes(32).toString('base64url');
const phone = (path, init = {}) =>
  fetch(origin + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-device-key': deviceKey } });

const offer = await link.request({ t: 'offer' });
const redeemed = await phone('/pair', { method: 'POST', body: JSON.stringify({ code: offer.code, deviceName: 'e2e phone' }) });
assert.equal(redeemed.status, 201);
const { pairing } = await redeemed.json();
assert.equal(pairing.status, 'pending');
await until('the computer to hear of the phone', () => events.find((e) => e.t === 'paired'));
const pending = await (await phone('/pairings')).json();
assert.equal(pending.pairings[0].status, 'pending');

// Noise key bootstrap and native AES-GCM business traffic pass as opaque records, including for pending pairings.
const socket = new WebSocket(origin.replace(/^http/,'ws')+'/phone');
const frames=[],replies=[];
let phoneChannel;
socket.onmessage=m=>{const f=JSON.parse(m.data);if(f.t==='sealed'){wire.push(f);phoneChannel.receive(f);}else frames.push(f);};
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
socket.send(JSON.stringify({t:'hello',token:TOKEN,deviceKey}));
await until('welcome',()=>frames.find(f=>f.t==='welcome'));
phoneChannel=new SecureChannel({pairingId:pairing.id,channelId:newChannelId(n=>randomBytes(n)),identity:phoneIdentity,initiator:true,importAesKey:mobileAes,
 expectedKey:hostIdentity.publicKey,random:n=>randomBytes(n),send:f=>{wire.push(f);socket.send(JSON.stringify(f));},
 ready:(_key,code)=>codes.push(code),message:value=>replies.push(value),closed:()=>{}});
phoneChannel.start();await until('both authenticated handshakes',()=>codes.length===2);
assert.equal(codes[0],codes[1]);phoneChannel.verified();hostChannel.verified();
// Confirmation follows the authenticated handshake, as safety-code verification requires.
assert.equal(await link.request({ t: 'decide', pairingId: pairing.id, accept: true }), null);
const listed = await (await phone('/pairings')).json();
assert.deepEqual(listed.pairings.map((p) => [p.id, p.status, p.online]), [[pairing.id, 'confirmed', true]]);
phoneChannel.send({method:'session/list',text:'PRIVATE_RELAY_SENTINEL',blob:'x'.repeat(1000000)});
await until('encrypted answer',()=>replies.length===1);
assert.deepEqual(replies[0],{echoed:'session/list',blob:'x'.repeat(1000000)});
assert.equal(business.length,1);
assert.ok(!JSON.stringify(wire).includes('PRIVATE_RELAY_SENTINEL'));
assert.ok(!JSON.stringify(wire).includes('session/list'));
assert.ok(wire.every(f=>JSON.stringify(f).length<1024*1024));
// A second handset with the same account token cannot enumerate, revoke, or displace this channel.
const otherPhone = path => fetch(origin+path,{headers:{authorization:`Bearer ${TOKEN}`,'x-device-key':otherDeviceKey}});
assert.deepEqual((await (await otherPhone('/pairings')).json()).pairings,[]);
assert.equal((await fetch(origin+'/pairings/'+pairing.id,{method:'DELETE',headers:{authorization:`Bearer ${TOKEN}`,'x-device-key':otherDeviceKey}})).status,404);
const otherSocket = new WebSocket(origin.replace(/^http/,'ws')+'/phone');
const otherFrames=[];
otherSocket.onmessage=event=>otherFrames.push(JSON.parse(event.data));
await new Promise((resolve,reject)=>{otherSocket.onopen=resolve;otherSocket.onerror=reject;});
otherSocket.send(JSON.stringify({t:'hello',token:TOKEN,deviceKey:otherDeviceKey}));
await until('other handset welcome',()=>otherFrames.some(f=>f.t==='welcome'));
otherSocket.send(JSON.stringify({t:'sealed',pairingId:pairing.id,channelId:newChannelId(n=>randomBytes(n)),kind:'commit',data:base64(randomBytes(32))}));
await until('other handset refused',()=>otherFrames.some(f=>f.error==='not_paired'));
assert.ok(!frames.some(f=>f.t==='detached'));
phoneChannel.send({method:'session/list',blob:'original phone still connected'});
await until('original channel survives attempted takeover',()=>replies.length===2);
assert.deepEqual(replies[1],{echoed:'session/list',blob:'original phone still connected'});
otherSocket.close();
// Revoked on the computer: the phone loses it at once.
assert.equal(await link.request({ t: 'revoke', pairingId: pairing.id }), null);
await until('the revocation', () => frames.find((f) => f.t === 'revoked'));
phoneChannel.close();hostChannel.close();socket.close();
link.stop();
console.log('relay e2e ok');
