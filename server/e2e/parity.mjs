// The parity run (docs/tech/go-server.md, "Order of work"): the same requests
// against the Node server and the Go server, compared by status, error code
// and body, with ids, times and tokens normalized. Part of each phase's gate,
// not of CI; deleted with the Node server in phase 6.
//
//   NODE_BASE=… NODE_TOKEN=… GO_BASE=… GO_TOKEN=… STUB_URL=… node parity.mjs
//
// Each token is a plugin Bearer token for a fresh account on its server.
// Only routes both servers serve over HTTP are compared; the Node server's
// browser sign-in is server actions, so the session routes are not.

const servers = {
  node: { base: process.env.NODE_BASE, token: process.env.NODE_TOKEN, ids: {}, kind: 'node' },
  go: { base: process.env.GO_BASE, token: process.env.GO_TOKEN, ids: {}, kind: 'go' },
};

// A second person's plugin token on each server. The Node server's is minted
// with its AUTH_SECRET, as its own plugin hand-off would; the Go server's is
// earned the way a person does: the first password an admin handed over,
// changed, then the plugin's PKCE hand-off.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
async function memberToken(server, email, firstPassword) {
  if (server.kind === 'node') {
    const require = createRequire(process.env.NODE_WEB + '/package.json');
    const { encode } = await import(require.resolve('next-auth/jwt'));
    return encode({ token: { sub: email, email, via: 'password' }, secret: process.env.NODE_AUTH_SECRET, salt: 'dsh-teamwork.plugin-session', maxAge: 3600 });
  }
  let cookie = '';
  const post = async (path, body) => {
    const res = await fetch(server.base + path, { method: 'POST', headers: { Origin: server.base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  await post('/api/auth/password/sign-in', { email, password: firstPassword });
  await post('/api/auth/password/change', { current: firstPassword, next: 'a member password long enough' });
  const verifier = randomBytes(32).toString('base64url');
  const { code } = await post('/api/auth/plugin/code', { challenge: createHash('sha256').update(verifier).digest('base64url') });
  return (await post('/api/auth/plugin/token', { code, verifier })).token;
}
const STUB = process.env.STUB_URL;
// A new member each run: the Node server's database outlives a run.
const MEMBER = `member-${Date.now()}@example.com`;

async function call(server, method, path, body, { auth = true, raw = false, as } = {}) {
  const token = as === 'member' ? server.memberToken : server.token;
  const res = await fetch(server.base + path.replace(/\{(\w+)\}/g, (_, k) => server.ids[k] ?? k), {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body).replace(/\{(\w+)\}/g, (_, k) => server.ids[k] ?? k),
  });
  const text = await res.text();
  let json = null;
  if (!raw) try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, type: (res.headers.get('content-type') ?? '').split(';')[0], json, text };
}

const ID = /^[A-Za-z0-9_-]{21}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
/** Ids, times and validation messages differ by nature; everything else must not. */
function normalize(value, names, key) {
  // A validation message is each server's own wording; where it points is not.
  if (key === 'issues') return value.map((issue) => issue.path.join('.'));
  if (Array.isArray(value)) return value.map((v) => normalize(v, names));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, normalize(value[k], names, k)]));
  }
  // A first password or a token is the server's random; whether there is one is not.
  if ((key === 'password' || key === 'token') && typeof value === 'string') return '<secret>';
  if (typeof value === 'string' && ID.test(value)) return names.get(value) ?? (names.set(value, `<id${names.size + 1}>`), names.get(value));
  if (typeof value === 'string' && TIME.test(value)) return '<time>';
  return value;
}

const cases = [];
const step = (name, method, path, body, opts = {}) => cases.push({ name, method, path, body, opts });

step('create team', 'POST', '/api/teams', { name: ' Core ' }, { keep: { teamId: 'id' } });
step('team: empty name', 'POST', '/api/teams', { name: '' });
step('team: not JSON', 'POST', '/api/teams', 'nope');
step('provider', 'POST', '/api/teams/{teamId}/providers', { name: 'stub', baseUrl: STUB, apiKey: 'sk-stub' }, { keep: { providerId: 'id' } });
step('provider: twice', 'POST', '/api/teams/{teamId}/providers', { name: 'stub', baseUrl: STUB, apiKey: 'sk-stub' });
step('provider: query in URL', 'POST', '/api/teams/{teamId}/providers', { name: 'q', baseUrl: `${STUB}?x=1`, apiKey: 'k' });
step('provider: another team', 'POST', '/api/teams/nosuchteamnosuchteam1/providers', { name: 'x', baseUrl: STUB, apiKey: 'k' });
step('model', 'POST', '/api/teams/{teamId}/configs', { kind: 'model', name: 'Stub', data: { provider: 'stub', model: 'stub-model', maxTokens: 4096 } }, { keep: { modelId: 'id' } });
step('model: unknown provider', 'POST', '/api/teams/{teamId}/configs', { kind: 'model', name: 'X', data: { provider: 'nope', model: 'm' } });
step('model: maxTokens over context', 'POST', '/api/teams/{teamId}/configs', { kind: 'model', name: 'Y', data: { provider: 'stub', model: 'm', contextWindow: 10, maxTokens: 20 } });
step('model: twice', 'POST', '/api/teams/{teamId}/configs', { kind: 'model', name: 'Stub', data: { provider: 'stub', model: 'other' } });
step('model: unknown field', 'POST', '/api/teams/{teamId}/configs', { kind: 'model', name: 'Z', data: { provider: 'stub', model: 'm', temperature: 1 } });
step('plugin', 'POST', '/api/teams/{teamId}/configs', { kind: 'plugin', name: 'Tools', data: { package: '@acme/tools', version: '1.2.3' } }, { keep: { pluginId: 'id' } });
step('preset', 'POST', '/api/teams/{teamId}/configs', { kind: 'preset', name: 'Writer', data: { modelConfigId: '{modelId}', pluginDependencies: [{ pluginConfigId: '{pluginId}', version: '1.2.3' }], requiredTools: ['read'] } }, { keep: { presetId: 'id' } });
step('preset: wrong plugin version', 'POST', '/api/teams/{teamId}/configs', { kind: 'preset', name: 'W2', data: { modelConfigId: '{modelId}', pluginDependencies: [{ pluginConfigId: '{pluginId}', version: '9.9.9' }] } });
step('preset: both model and own route', 'POST', '/api/teams/{teamId}/configs', { kind: 'preset', name: 'W3', data: { modelConfigId: '{modelId}', provider: 'stub', model: 'm' } });
step('config: unknown kind', 'POST', '/api/teams/{teamId}/configs', { kind: 'agent', name: 'A', data: {} });
step('snapshot', 'GET', '/api/configs');
step('call: plain', 'POST', '/api/llm/chat/completions', { model: '{modelId}', messages: [{ role: 'user', content: 'hi' }], user: 'dropped' });
step('call: stream', 'POST', '/api/llm/chat/completions', { model: '{modelId}', messages: [{ role: 'user', content: 'hi' }], stream: true }, { raw: true });
step('call: through a preset', 'POST', '/api/llm/chat/completions', { model: '{presetId}', messages: [{ role: 'user', content: 'hi' }] });
step('call: unknown model', 'POST', '/api/llm/chat/completions', { model: 'nope', messages: [{}] });
step('call: max_tokens over the model', 'POST', '/api/llm/chat/completions', { model: '{modelId}', messages: [{}], max_tokens: 99999 });
step('call: both max fields', 'POST', '/api/llm/chat/completions', { model: '{modelId}', messages: [{}], max_tokens: 5, max_completion_tokens: 5 });
step('call: no messages', 'POST', '/api/llm/chat/completions', { model: '{modelId}', messages: [] });
step('teams', 'GET', '/api/teams');
step('team', 'GET', '/api/teams/{teamId}');
step('team: not in it', 'GET', '/api/teams/nosuchteamnosuchteam1');
step('configs', 'GET', '/api/teams/{teamId}/configs');
step('providers', 'GET', '/api/teams/{teamId}/providers');
step('provider: move', 'PUT', '/api/teams/{teamId}/providers/{providerId}', { baseUrl: STUB + '/' });
step('provider: move, bad address', 'PUT', '/api/teams/{teamId}/providers/{providerId}', { baseUrl: 'ftp://x' });
step('provider: remove while called', 'DELETE', '/api/teams/{teamId}/providers/{providerId}');
step('catalog: no provider', 'GET', '/api/teams/{teamId}/model-catalog');
step('catalog: provider without /models', 'GET', '/api/teams/{teamId}/model-catalog?provider=stub');
step('catalog: unknown provider', 'GET', '/api/teams/{teamId}/model-catalog?provider=nope');
step('config: edit', 'PATCH', '/api/teams/{teamId}/configs/{modelId}', { kind: 'model', name: 'Stub', data: { provider: 'stub', model: 'stub-model', maxTokens: 2048 }, version: 1 });
step('config: edit, stale', 'PATCH', '/api/teams/{teamId}/configs/{modelId}', { kind: 'model', name: 'Stub', data: { provider: 'stub', model: 'stub-model' }, version: 1 });
step('model: another', 'POST', '/api/teams/{teamId}/configs', { kind: 'model', name: 'Other', data: { provider: 'stub', model: 'other' } });
step('config: edit onto a name in use', 'PATCH', '/api/teams/{teamId}/configs/{modelId}', { kind: 'model', name: 'Other', data: { provider: 'stub', model: 'stub-model' }, version: 2 });
step('config: remove a model a preset uses', 'DELETE', '/api/teams/{teamId}/configs/{modelId}');
step('config: remove a plugin a preset pins', 'DELETE', '/api/teams/{teamId}/configs/{pluginId}');
step('member: add', 'POST', '/api/teams/{teamId}/members', { email: MEMBER.replace('member', 'Member') }, { keep: { memberId: 'userId', memberPassword: 'password' } });
step('member: add again', 'POST', '/api/teams/{teamId}/members', { email: MEMBER });
step('member: add, not an email', 'POST', '/api/teams/{teamId}/members', { email: 'nope' });
step('member: reset own password', 'POST', '/api/teams/{teamId}/members/{selfId}/password');
step('member: reset', 'POST', '/api/teams/{teamId}/members/{memberId}/password', undefined, { keep: { memberPassword: 'password' } });
step('member: becomes a plugin', 'MEMBER', '');
step('as member: team', 'GET', '/api/teams/{teamId}', undefined, { as: 'member' });
step('as member: write', 'POST', '/api/teams/{teamId}/configs', { kind: 'plugin', name: 'M', data: { package: 'm', version: '1.0.0' } }, { as: 'member' });
step('as member: catalog', 'GET', '/api/teams/{teamId}/model-catalog?provider=stub', undefined, { as: 'member' });
step('invite', 'POST', '/api/teams/{teamId}/invites', undefined, { keep: { inviteId: 'id', inviteToken: 'token' } });
step('invites', 'GET', '/api/teams/{teamId}/invites');
step('as member: redeem, already in', 'POST', '/api/invites/redeem', { token: '{inviteToken}' }, { as: 'member' });
step('redeem: unknown token', 'POST', '/api/invites/redeem', { token: 'x'.repeat(43) });
step('redeem: short token', 'POST', '/api/invites/redeem', { token: 'x' });
step('invite: revoke', 'DELETE', '/api/teams/{teamId}/invites/{inviteId}');
step('admin: leave', 'DELETE', '/api/teams/{teamId}/membership');
step('as member: leave', 'DELETE', '/api/teams/{teamId}/membership', undefined, { as: 'member' });
step('as member: team after leaving', 'GET', '/api/teams/{teamId}', undefined, { as: 'member' });
step('member: remove self', 'DELETE', '/api/teams/{teamId}/members/{selfId}');
step('member: remove one not in it', 'DELETE', '/api/teams/{teamId}/members/{memberId}');
step('profile', 'GET', '/api/profile');
step('profile: patch', 'PATCH', '/api/profile', { name: ' Ada ', locale: 'zh-CN' });
step('profile: clear', 'PATCH', '/api/profile', { name: null });
step('profile: bad patch', 'PATCH', '/api/profile', { name: '', locale: 'fr' });
step('token: malformed', 'POST', '/api/auth/plugin/token', { code: 'x', verifier: 'short' }, { auth: false });
step('token: wrong code', 'POST', '/api/auth/plugin/token', { code: 'x', verifier: 'v'.repeat(43) }, { auth: false });
step('unknown route', 'GET', '/api/nope');
step('anonymous', 'GET', '/api/configs', undefined, { auth: false });

for (const server of Object.values(servers)) server.ids.selfId = (await call(server, 'GET', '/api/profile')).json.id;
let differ = 0;
const names = { node: new Map(), go: new Map() };
for (const c of cases) {
  if (c.method === 'MEMBER') {
    for (const server of Object.values(servers)) server.memberToken = await memberToken(server, MEMBER, server.ids.memberPassword);
    continue;
  }
  const got = {};
  for (const [key, server] of Object.entries(servers)) {
    got[key] = await call(server, c.method, c.path, c.body, c.opts);
    for (const [name, field] of Object.entries(c.opts.keep ?? {})) server.ids[name] = got[key].json?.[field];
  }
  const view = (r, key) => JSON.stringify({ status: r.status, type: r.type, body: c.opts.raw ? r.text : normalize(r.json ?? r.text, names[key]) });
  const [n, g] = [view(got.node, 'node'), view(got.go, 'go')];
  const same = n === g;
  if (!same) differ++;
  console.log(`${same ? 'same  ' : 'DIFFER'} ${c.name}`);
  if (!same) console.log(`  node: ${n.slice(0, 400)}\n  go:   ${g.slice(0, 400)}`);
}
const compared = cases.filter((c) => c.method !== 'MEMBER').length;
console.log(`\n${compared - differ} of ${compared} the same`);
process.exit(differ ? 1 : 0);
