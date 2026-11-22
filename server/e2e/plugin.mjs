// The DSH plugin, unchanged, against a running Go server: the plugin's own
// TeamworkClient and loopback listener (../dsh-teamwork, or $DSH_TEAMWORK_PLUGIN)
// sign in, sync and call a model, with this script standing in for the
// person's browser. Run by e2e_test.go, which starts the server and a stub
// provider; see docs/tech/go-server.md, phase 1.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { BASE, SETUP_TOKEN, STUB_URL, PLUGIN } = process.env;
const { TeamworkClient } = await import(pathToFileURL(join(PLUGIN, 'lib/client.js')).href);
const { platformAdapter, teamProvider } = await import(pathToFileURL(join(PLUGIN, 'lib/platform-models.js')).href);
const { listenForCode } = await import(pathToFileURL(join(PLUGIN, 'lib/login-callback.js')).href);

// Keep the cookies returned for this origin, including updates and removals.
const cookies = new Map();
async function browser(path, body, method = body === undefined ? 'GET' : 'POST') {
  const cookie = [...cookies.values()].join('; ');
  const response = await fetch(`${BASE}/api/${path}`, {
    method,
    headers: { Origin: BASE, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const set of response.headers.getSetCookie()) {
    const [pair, ...attributes] = set.split(';');
    const name = pair.slice(0, pair.indexOf('='));
    if (attributes.some(attribute => attribute.trim().toLowerCase() === 'max-age=0')) cookies.delete(name);
    else cookies.set(name, pair);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// The admin claims the instance and sets a team up.
await browser('auth/setup', { token: SETUP_TOKEN, email: 'admin@example.com', password: 'correct horse battery' });
const team = await browser('teams', { name: 'Core' });
await browser(`teams/${team.id}/providers`, { name: 'stub', baseUrl: STUB_URL, apiKey: 'sk-e2e' });
const model = await browser(`teams/${team.id}/configs`, { kind: 'model', name: 'Stub', data: { provider: 'stub', model: 'stub-model', contextWindow: 4096, maxTokens: 512, reasoningEfforts: ['low', 'high'] } });
// Every call needs a rate (ADR 0050); zero is one.
await browser(`teams/${team.id}/model-rates/${model.id}`, { revision: 0, basis: 'cost', input: '0', cacheRead: '0', cacheWrite: '0', output: '0' }, 'PUT');

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
assert.deepEqual(snapshot.teams[0].configs.filter(c=>c.kind==='model').map(c => c.id), [model.id]);
assert.equal(snapshot.teams[0].configs.filter(c=>c.builtin==='team-assistant' && c.kind==='preset' && c.data.inheritModel===true).length,1);

// A team model, called the way DSH calls it through the plugin.
const call = () =>
  fetch(`${client.endpoint}/api/llm/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.platformCredential()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.id, messages: [{ role: 'user', content: 'hi' }] }),
  });
const plain = await call();
assert.equal(plain.status, 200);
assert.equal((await plain.json()).choices[0].message.content, 'hello');
const adapter = platformAdapter(client);
const provider = teamProvider(team.id);
const info = await adapter.resolveModel(provider, model.id);
assert.deepEqual(info.reasoning.efforts.map(({ id }) => id), ['low', 'high']);
let text = '';
for await (const chunk of adapter.stream({
  provider, model: model.id, reasoningEffort: 'high',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
})) {
  if (chunk.type === 'text-delta') text += chunk.text;
  if (chunk.type === 'finish') assert.notEqual(chunk.reason.kind, 'error');
}
assert.equal(text, 'hi');


// Exercise the plugin's actual local preparation, upload, approval, sync and download path.
const workspace=mkdtempSync(join(tmpdir(),'teamwork-share-e2e-'));
let prepared;
try {
 const directory=join(workspace,'plugin');await mkdir(directory);
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'teamwork-e2e-private',version:'1.0.0',type:'module',main:'index.js',files:['index.js']}));
 await writeFile(join(directory,'index.js'),'export function apply() {}');
 const {preparePlugin}=await import(pathToFileURL(join(PLUGIN,'lib/local-share.js')).href);
 prepared=await preparePlugin(workspace,'plugin',new AbortController().signal);
 const pending=await client.submitPlugin(team.id,await readFile(prepared.path),prepared.sha256,{name:'Private fixture',note:'Actual client upload',baseVersion:0},new AbortController().signal);
 assert.equal(pending.state,'pending');
 await browser(`teams/${team.id}/submissions/${pending.id}/approve`,{revision:pending.revision});
 const synced=await client.sync();const shared=synced.teams[0].configs.find(c=>c.kind==='plugin'&&c.name==='Private fixture');assert(shared);
 const downloaded=await client.downloadArtifact(team.id,shared.data.artifactId,shared.data.sha256);
 assert.deepEqual(await readFile(downloaded),await readFile(prepared.path));
 console.log('private plugin e2e ok: prepared, submitted, approved, synced and downloaded exact bytes');
} finally {if(prepared)await rm(prepared.directory,{recursive:true,force:true});await rm(workspace,{recursive:true,force:true});}

// A page, as the plugin's teamwork_page tool publishes one (docs/tech/pages.md): its own file collection and upload,
// then the browser opens both versions through view addresses, and finds the first unchanged.
const pageSpace=mkdtempSync(join(tmpdir(),'teamwork-page-e2e-'));
try {
 const {pageFiles}=await import(pathToFileURL(join(PLUGIN,'lib/page-tool.js')).href);
 await mkdir(join(pageSpace,'report'));
 await writeFile(join(pageSpace,'report','index.html'),'<link rel="stylesheet" href="style.css"><h1>v1</h1>');
 await writeFile(join(pageSpace,'report','style.css'),'h1{color:red}');
 const meta={kind:'html',note:'first',sessionId:'session-e2e',computer:'e2e'};
 const first=await client.publishPage(team.id,{...meta,title:'Q4 report'},await pageFiles(pageSpace,'html',undefined,'report'),new AbortController().signal);
 assert.equal(first.version,1);
 await writeFile(join(pageSpace,'report','index.html'),'<link rel="stylesheet" href="style.css"><h1>v2</h1>');
 const second=await client.publishPage(team.id,{...meta,pageId:first.id,baseVersion:1,note:'second'},await pageFiles(pageSpace,'html',undefined,'report'),new AbortController().signal);
 assert.equal(second.version,2);
 await assert.rejects(client.publishPage(team.id,{...meta,pageId:first.id,baseVersion:1},await pageFiles(pageSpace,'html',undefined,'report'),new AbortController().signal),e=>e.code==='page_stale');
 for (const [n,heading] of [[1,'v1'],[2,'v2']]) {
  const view=await browser(`teams/${team.id}/pages/${first.id}/versions/${n}/view`,{});
  const page=await fetch(view.url);
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/^sandbox allow-scripts /);
  assert.ok((await page.text()).includes(`<h1>${heading}</h1>`));
  assert.equal(await (await fetch(view.url+'style.css')).text(),'h1{color:red}');
 }
 // open: the plugin reads a version back, file for file, to change it.
 const opened=await client.readPage(team.id,first.id,1,undefined,new AbortController().signal);
 assert.deepEqual(opened.map(f=>[f.path,new TextDecoder().decode(f.bytes)]).sort(),[['index.html','<link rel="stylesheet" href="style.css"><h1>v1</h1>'],['style.css','h1{color:red}']]);
 console.log('page e2e ok: published, versioned, refused a stale base, viewed both versions and opened one');
} finally {await rm(pageSpace,{recursive:true,force:true});}

callback.close();
console.log(`plugin e2e ok: signed in, synced ${snapshot.teams[0].configs.length} configuration, two calls through the gateway`);
