// The DSH plugin, unchanged, against a running Go server: the plugin's own
// TeamworkClient and loopback listener (../dsh-teamwork, or $DSH_TEAMWORK_PLUGIN)
// sign in, sync and call a model, with this script standing in for the
// person's browser. Run by e2e_test.go, which starts the server and a stub
// provider; see docs/tech/go-server.md, phase 1.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdir,writeFile,readFile,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { BASE, STUB_URL, PLUGIN } = process.env;
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
await browser('auth/setup', { email: 'admin@example.com', password: 'correct horse battery' });
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


// Exercise the plugin's actual local preparation, upload, default selection, sync and download path.
const workspace=mkdtempSync(join(tmpdir(),'teamwork-share-e2e-'));
let prepared;
try {
 const directory=join(workspace,'plugin');await mkdir(directory);
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'teamwork-e2e-private',version:'1.0.0',type:'module',main:'index.js',files:['index.js']}));
 await writeFile(join(directory,'index.js'),'export function apply() {}');
 const {preparePlugin}=await import(pathToFileURL(join(PLUGIN,'lib/local-share.js')).href);
 prepared=await preparePlugin(workspace,'plugin',new AbortController().signal);
 const published=await client.publishPlugin(team.id,await readFile(prepared.path),prepared.sha256,{name:'Private fixture',description:'Actual client upload',baseVersion:0},new AbortController().signal);
 assert.equal(published.version,1);
 assert((await client.sync()).teams[0].configs.some(c=>c.id===published.id));
 await browser(`teams/${team.id}/asset-defaults/${published.id}`,{version:published.version},'PUT');
 const synced=await client.sync();const shared=synced.teams[0].configs.find(c=>c.kind==='plugin'&&c.name==='Private fixture');assert(shared);
 const downloaded=await client.downloadPackage(team.id,shared.data.packageId,shared.data.sha256);
 assert.deepEqual(await readFile(downloaded),await readFile(prepared.path));
 console.log('private plugin e2e ok: prepared, published, selected, synced and downloaded exact bytes');
} finally {if(prepared)await rm(prepared.directory,{recursive:true,force:true});await rm(workspace,{recursive:true,force:true});}

// An artifact, as the plugin's teamwork_artifact tool publishes one (docs/tech/artifacts.md): its own file collection and upload,
// then the browser opens both versions through view addresses, and finds the first unchanged.
const artifactSpace=mkdtempSync(join(tmpdir(),'teamwork-artifact-e2e-'));
try {
 const {artifactFiles}=await import(pathToFileURL(join(PLUGIN,'lib/artifact-tool.js')).href);
 await mkdir(join(artifactSpace,'report'));
 await writeFile(join(artifactSpace,'report','index.html'),'<link rel="stylesheet" href="style.css"><h1>v1</h1>');
 await writeFile(join(artifactSpace,'report','style.css'),'h1{color:red}');
 const meta={kind:'html',note:'first',sessionId:'session-e2e',computer:'e2e'};
 const first=await client.publishArtifact(team.id,{...meta,title:'Q4 report'},await artifactFiles(artifactSpace,'html',undefined,'report'),new AbortController().signal);
 assert.equal(first.version,1);
 await writeFile(join(artifactSpace,'report','index.html'),'<link rel="stylesheet" href="style.css"><h1>v2</h1>');
 const second=await client.publishArtifact(team.id,{...meta,artifactId:first.id,baseVersion:1,note:'second'},await artifactFiles(artifactSpace,'html',undefined,'report'),new AbortController().signal);
 assert.equal(second.version,2);
 await assert.rejects(client.publishArtifact(team.id,{...meta,artifactId:first.id,baseVersion:1},await artifactFiles(artifactSpace,'html',undefined,'report'),new AbortController().signal),e=>e.code==='artifact_stale');
 for (const [n,heading] of [[1,'v1'],[2,'v2']]) {
  const view=await browser(`teams/${team.id}/artifacts/${first.id}/versions/${n}/view`,{});
  const served=await fetch(view.url);
  assert.equal(served.status,200);
  assert.match(served.headers.get('content-security-policy'),/^sandbox allow-scripts /);
  assert.ok((await served.text()).includes(`<h1>${heading}</h1>`));
  assert.equal(await (await fetch(view.url+'style.css')).text(),'h1{color:red}');
 }
 // open: the plugin reads a version back, file for file, to change it.
 const opened=await client.readArtifact(team.id,first.id,1,new AbortController().signal);
 assert.deepEqual(opened.map(f=>[f.path,new TextDecoder().decode(f.bytes)]).sort(),[['index.html','<link rel="stylesheet" href="style.css"><h1>v1</h1>'],['style.css','h1{color:red}']]);
 console.log('artifact e2e ok: published, versioned, refused a stale base, viewed both versions and opened one');
} finally {await rm(artifactSpace,{recursive:true,force:true});}

// Knowledge (docs/tech/knowledge.md): the plugin's KnowledgeSync writes the read-only copy, attachments beside each
// document, and its teamwork_knowledge tool proposes a change, with the files it names, that leaves the document as it
// was until the admin accepts it.
const knowledgeSpace=mkdtempSync(join(tmpdir(),'teamwork-knowledge-e2e-'));
try {
 const {KnowledgeSync}=await import(pathToFileURL(join(PLUGIN,'lib/knowledge-sync.js')).href);
 const {registerKnowledgeTool}=await import(pathToFileURL(join(PLUGIN,'lib/knowledge-tool.js')).href);
 const space=await browser(`teams/${team.id}/knowledge/spaces`,{name:'Handbook'});
 const folder=await browser(`teams/${team.id}/knowledge/folders`,{spaceId:space.id,parentId:'',name:'Ops'});
 const created=await browser(`teams/${team.id}/knowledge/documents`,{spaceId:space.id,folderId:folder.id,title:'Runbook',text:'# Runbook\n\n## Restart\n\nRun the restart script.\n',note:'first'});
 // The admin attaches a diagram; the browser helper speaks JSON only, so the upload goes through the admin's plugin client.
 const diagram=Buffer.from('\x89PNG\r\n\x1a\ndiagram','latin1');
 const uploaded=await client.attachKnowledge(team.id,created.id,'diagram.png',diagram,new AbortController().signal);
 assert.deepEqual(uploaded,{name:'diagram.png',contentType:'image/png',size:diagram.length});
 const knowledge=new KnowledgeSync(client);
 await knowledge.restore();
 await knowledge.sync();
 const file=join(knowledge.root,'Core','Handbook','Ops','Runbook.md');
 assert.equal(await readFile(file,'utf8'),`---\nknowledge: ${created.id}@1\n---\n# Runbook\n\n## Restart\n\nRun the restart script.\n`);
 assert.equal((await stat(file)).mode&0o777,0o444);
 const files=join(knowledge.root,'Core','Handbook','Ops','Runbook.files');
 assert.deepEqual(await readFile(join(files,'diagram.png')),diagram);
 assert.equal((await stat(join(files,'diagram.png'))).mode&0o777,0o444);

 // The agent copies the synced file into its workspace, changes it, and proposes it through the tool.
 let tool;
 registerKnowledgeTool({effect:f=>f(),tools:{register:t=>{tool=t;return()=>{};}}},{client,knowledge});
 const copy=join(knowledgeSpace,'Runbook.md');
 await writeFile(copy,(await readFile(file,'utf8')).replace('Run the restart script.','Drain traffic first, then run the restart script.'));
 const exec={agent:{session:{header:{id:'session-e2e',cwd:knowledgeSpace}}},signal:new AbortController().signal};
 const proposed=await tool.execute({action:'propose',documentId:created.id,baseVersion:1,note:'Drain first',path:'Runbook.md'},exec);
 assert.equal(proposed.teamId,team.id);
 assert.equal(proposed.baseVersion,1);
 const unchanged=await browser(`teams/${team.id}/knowledge/documents/${created.id}`);
 assert.equal(unchanged.currentVersion,1);
 assert.equal(unchanged.text,'# Runbook\n\n## Restart\n\nRun the restart script.\n');
 const pending=await browser(`teams/${team.id}/knowledge/proposals/${proposed.proposalId}`);
 assert.equal(pending.source,'agent');
 assert.equal(pending.state,'pending');
 assert.equal(pending.text,'# Runbook\n\n## Restart\n\nDrain traffic first, then run the restart script.\n');

 await browser(`teams/${team.id}/knowledge/proposals/${proposed.proposalId}/accept`,{});
 const accepted=await browser(`teams/${team.id}/knowledge/documents/${created.id}`);
 assert.equal(accepted.currentVersion,2);
 assert.equal(accepted.text,pending.text);

 // The same base is stale now: the tool answers with version 2 and its text, for the agent to reapply.
 const stale=await tool.execute({action:'propose',documentId:created.id,baseVersion:1,note:'Again',content:'# Runbook\n'},exec);
 assert.equal(stale.stale,true);
 assert.equal(stale.version,2);
 assert.equal(stale.text,pending.text);

 await knowledge.sync();
 assert.equal(await readFile(file,'utf8'),`---\nknowledge: ${created.id}@2\n---\n${pending.text}`);

 // The agent proposes text naming the admin's diagram and a chart of its own, which the tool uploads first.
 const chart=Buffer.from('\x89PNG\r\n\x1a\nchart','latin1');
 await writeFile(join(knowledgeSpace,'chart.png'),chart);
 const withChart=`${pending.text}\n![[diagram.png]]\n\n![[chart.png]]\n`;
 const charted=await tool.execute({action:'propose',documentId:created.id,baseVersion:2,note:'Add the chart',content:withChart,attachments:['chart.png']},exec);
 assert.deepEqual(charted.attachments,['chart.png']);
 // Another file under the diagram's name is refused before anything is proposed, and the agent is told to rename it.
 await mkdir(join(knowledgeSpace,'other'));
 await writeFile(join(knowledgeSpace,'other','diagram.png'),chart);
 await assert.rejects(tool.execute({action:'propose',documentId:created.id,baseVersion:2,note:'Replace',content:'![[diagram.png]]',attachments:['other/diagram.png']},exec),/already has a different file named diagram\.png/);
 await browser(`teams/${team.id}/knowledge/proposals/${charted.proposalId}/accept`,{});
 await knowledge.sync();
 assert.equal(await readFile(file,'utf8'),`---\nknowledge: ${created.id}@3\n---\n${withChart}`);
 assert.deepEqual(await readFile(join(files,'diagram.png')),diagram);
 assert.deepEqual(await readFile(join(files,'chart.png')),chart);
 assert.equal((await stat(join(files,'chart.png'))).mode&0o777,0o444);
 console.log('knowledge e2e ok: synced read-only with attachments, proposed through the tool with a new attachment, unchanged until accepted, stale answered, versions 2 and 3 synced');
} finally {await rm(knowledgeSpace,{recursive:true,force:true});}

callback.close();
console.log(`plugin e2e ok: signed in, synced ${snapshot.teams[0].configs.length} configuration, two calls through the gateway`);
