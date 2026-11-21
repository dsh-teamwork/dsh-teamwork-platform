/**
 * The live RelayClient against a scripted relay socket: where it connects, how
 * it introduces itself, and the paths a screen depends on — computers, a
 * followed session, a question asked and answered, and a pairing cut off.
 */
// Business-flow unit tests use a transport stub. Actual Noise/AES, tamper/replay,
// cross-repository wire parity and real relay tests run in the companion suite.
vi.mock('../secure-channel', () => ({
  newChannelId: () => 'abcdefghijklmnopqrstuv',
  securePacket: (frame: any) => frame?.t === 'sealed',
  SecureChannel: class {
    constructor(private options: any) {}
    get id() { return this.options.channelId; }
    start() { this.options.ready('host-key', '1234 5678'); this.send({ t: 'mockHandshake' }); }
    send(value: unknown) { this.options.send({ t: 'sealed', pairingId: this.options.pairingId, channelId: this.id, kind: 'data', data: JSON.stringify(value) }); }
    receive(frame: any) { void this.options.message(JSON.parse(frame.data)); }
    verified() {}
    close(error?: Error) { this.options.closed(error ?? new Error('channel_closed')); }
  },
}));
import { describe, expect, it, vi } from 'vitest';
import { createLiveRelay } from '../live';
import { RETRY_MS } from '../dsh-sessions';
import { RelayError, type SessionEvent } from '../types';

class FakeSocket {
  static made: FakeSocket[] = [];
  /** Pairings whose desktop is not connected: the relay refuses their packets. */
  static offline = new Set<string>();
  /** A shared DSH a member joins answers no handshake marker: it waits for the invite. */
  static quiet = false;
  sent: any[] = [];
  channels = new Map<string,string>();
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.made.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string) {
    const frame = JSON.parse(data);
    if (frame.t === 'sealed') {
      this.channels.set(frame.pairingId, frame.channelId);
      if (FakeSocket.offline.has(frame.pairingId)) { queueMicrotask(() => this.push({ t: 'error', pairingId: frame.pairingId, error: 'offline' })); return; }
      const inner = JSON.parse(frame.data);
      if (inner.t === 'mockHandshake') { if (!FakeSocket.quiet) queueMicrotask(() => this.push({ t: 'secureReady', pairingId: frame.pairingId })); return; }
      if (inner.t === 'revoke') { queueMicrotask(() => this.push({ t: 'revokedAck', pairingId: frame.pairingId })); return; }
      this.sent.push(inner); return;
    }
    this.sent.push(frame);
  }
  close() {
    this.onclose?.();
  }
  /** The relay sends a frame. */
  push(frame: unknown) {
    const inner = frame as any;
    const outer = ['result','mux','secureReady','revokedAck'].includes(inner.t) ? { t: 'sealed', pairingId: inner.pairingId, channelId: this.channels.get(inner.pairingId), kind: 'data', data: JSON.stringify(inner) } : inner;
    this.onmessage?.({ data: JSON.stringify(outer) });
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await tick();
};

/** Answers a computer's `teamwork/configuration` with the directories it offers; `nth` picks a later call. */
async function answerDirectories(s: FakeSocket, pairingId: string, directories: string[], nth = 0, teamDirectories: Record<string, string> = {}) {
  const asked = () => s.sent.filter((f) => f.method === 'teamwork/configuration' && f.pairingId === pairingId);
  await until(() => asked().length > nth);
  const call = asked()[nth];
  s.push({ t: 'result', pairingId, id: call.id, status: 200, body: { result: { ok: true, value: { presets: [], current: null, directories, teamDirectories } } } });
}

function setup() {
  FakeSocket.made = [];
  FakeSocket.quiet = false;
  let token = 'bearer-1';
  const asked: Array<{ url: string; init?: RequestInit }> = [];
  const request = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    if (url.endsWith('/api/relay')) return new Response(JSON.stringify({ url: 'wss://relay.example.test/plugin', push: true }));
    if (url.endsWith('/pairings'))
      return new Response(
        JSON.stringify({
          pairings: [
            { id: 'p1', hostName: 'laptop', hostOs: 'macos', hostLastSeenAt: '2026-11-19T08:00:00.000Z', status: 'confirmed', online: true, push: true, hostId: 'h', deviceName: 'd', createdAt: '', lastUsedAt: null },
            { id: 'p2', hostName: 'desk', hostOs: null, status: 'pending', online: true, hostId: 'h2', deviceName: 'd', createdAt: '', lastUsedAt: null },
          ],
        }),
      );
    if (url.endsWith('/hosts'))
      return token === 'old-server'
        ? new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
        : new Response(
            JSON.stringify({
              hosts: [
                { id: 'h', name: 'laptop', dshVersion: '0.9.0', pluginVersion: '0.18.0', os: 'macos', online: true, lastSeenAt: '2026-11-19T08:00:00.000Z', pairings: [{ id: 'p1', status: 'confirmed', current: true, deviceName: 'd', createdAt: '', lastUsedAt: null, push: true }] },
                { id: 'h2', name: 'desk', dshVersion: '0.8.0', pluginVersion: null, os: null, online: false, lastSeenAt: '2026-11-18T08:00:00.000Z', pairings: [{ id: 'p2', status: 'pending', current: true, deviceName: 'd', createdAt: '', lastUsedAt: null, push: false }] },
              ],
            }),
          );
    if (url.endsWith('/pair')) return new Response(JSON.stringify({ error: 'invalid_code' }), { status: 400 });
    if (url.endsWith('/push')) return new Response(null, { status: url.includes('/gone/') ? 404 : 204 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const credentials: Array<{server:string;token?:string}> = [];
  const relay = createLiveRelay({
    keys: { relayKey: async account => { credentials.push(account); return 'phone-key'; }, identity: async () => ({} as any), peer: async () => 'host-key', trust: async () => {}, forget: async () => {} },
    random: n => new Uint8Array(n).fill(1),
    session: async () => ({ server: 'https://teamwork.example.test', token }),
    locale: () => 'en',
    device: 'ios',
    request,
    WebSocket: FakeSocket as unknown as typeof WebSocket,
  });
  /** The socket, once open and welcomed. */
  const socket = async () => {
    await until(() => FakeSocket.made.length > 0 && FakeSocket.made[0]!.sent.length > 0);
    const s = FakeSocket.made[0]!;
    if (!s.sent.some((f) => f.t === 'welcomed-marker')) {
      s.sent.push({ t: 'welcomed-marker' });
      s.push({ t: 'welcome' });
    }
    return s;
  };
  const sentOf = (s: FakeSocket, match: (f: any) => boolean) => s.sent.find(match);
  /** The computer's $events stream opens and DSH says it is ready, after replaying `before`. */
  const eventsReady = async (s: FakeSocket, pairingId: string, before: unknown[] = []) => {
    await until(() => s.sent.some((f) => f.t === 'mux' && f.pairingId === pairingId && f.body.endpoint === '$events'));
    const { streamId } = s.sent.find((f) => f.t === 'mux' && f.pairingId === pairingId && f.body.endpoint === '$events').body;
    for (const value of [...before, { type: 'ready', clientId: 'c-1' }]) s.push({ t: 'mux', pairingId, body: { type: 'item', streamId, value } });
  };
  return { relay, asked, socket, sentOf, eventsReady, credentials, setToken: (next: string) => { token = next; } };
}

describe('the live relay client', () => {
  it('ends pending work on sign-out and uses a fresh authenticated socket afterwards', async () => {
    const { relay, socket, eventsReady, setToken, credentials } = setup();
    const pending = relay.listSessions('p1');
    const refused = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    const first = await socket();
    await eventsReady(first, 'p1');
    await until(() => first.sent.some((frame) => frame.t === 'call'));
    relay.reset();
    await refused;
    setToken('bearer-2');
    const next = relay.listSessions('p2');
    await until(() => FakeSocket.made.length === 2 && FakeSocket.made[1]!.sent.length > 0);
    const second = FakeSocket.made[1]!;
    expect(second).not.toBe(first);
    expect(second.sent[0]).toMatchObject({ t: 'hello', token: 'bearer-2', deviceKey: 'phone-key' });
    expect(credentials.at(-1)).toEqual({server:'https://teamwork.example.test',token:'bearer-2'});
    second.push({ t: 'welcome' });
    await eventsReady(second, 'p2');
    await until(() => second.sent.some((frame) => frame.t === 'call'));
    const call = second.sent.find((frame) => frame.t === 'call');
    second.push({ t: 'result', pairingId: 'p2', id: call.id, status: 200, body: { result: { ok: true, value: { items: [] } } } });
    expect(await next).toEqual([]);
    relay.reset();
  });
  it('cannot settle another computers’ pending request with an authenticated response', async () => {
    const { relay, socket } = setup();
    const one = relay.prompt('p1', 's', 'one');
    const two = relay.prompt('p2', 's', 'two');
    let settled = false;
    void two.then(() => { settled = true; });
    const s = await socket();
    await until(() => s.sent.filter(f => f.t === 'call').length === 2);
    const calls = s.sent.filter(f => f.t === 'call');
    const other = calls.find(f => f.pairingId === 'p2');
    s.push({ t: 'result', pairingId: 'p1', id: other.id, status: 200, body: { result: { ok: true } } });
    await tick(); expect(settled).toBe(false);
    for (const call of calls) s.push({ t: 'result', pairingId: call.pairingId, id: call.id, status: 200, body: { result: { ok: true } } });
    await Promise.all([one, two]); relay.reset();
  });

  it('checks confirmation for the exact new pairing, including a pending or removed one', async () => {
    const { relay } = setup();
    expect(await relay.getPairing('p2')).toMatchObject({ id: 'p2', status: 'pending' });
    expect(await relay.getPairing('p1')).toMatchObject({ id: 'p1', status: 'confirmed' });
    expect(await relay.getPairing('gone')).toBeNull();
  });

  it('revokes only the chosen pairing with the signed-in credential', async () => {
    const { relay, asked, socket } = setup();
    // An already removed pairing (404) is disconnected too.
    const revoked = relay.revokeComputer('old/pairing');
    await socket();
    await revoked;
    expect(asked.at(-1)).toMatchObject({
      url: 'https://relay.example.test/pairings/old%2Fpairing',
      init: { method: 'DELETE', headers: { authorization: 'Bearer bearer-1', 'x-device-key': 'phone-key' } },
    });
  });

  it('revokes a computer whose desktop is not connected at once, through the relay alone', async () => {
    const { relay, asked, socket } = setup();
    FakeSocket.offline.add('p1');
    try {
      const revoked = relay.revokeComputer('p1');
      await socket();
      // Without the relay's refusal ending the handshake, this waits for the handshake's own timeout.
      await revoked;
      expect(asked.at(-1)).toMatchObject({ url: 'https://relay.example.test/pairings/p1', init: { method: 'DELETE' } });
    } finally {
      FakeSocket.offline.clear();
      relay.reset();
    }
  });


  it('turns one computer’s notifications on with the token and language, or off with null', async () => {
    const { relay, asked } = setup();
    expect(await relay.offersPush()).toBe(true);
    await relay.setPush('p1', { pushToken: 'ExponentPushToken[abc]', locale: 'zh-CN' });
    expect(asked.at(-1)).toMatchObject({
      url: 'https://relay.example.test/pairings/p1/push',
      init: { method: 'PUT', body: JSON.stringify({ pushToken: 'ExponentPushToken[abc]', locale: 'zh-CN' }), headers: { authorization: 'Bearer bearer-1', 'x-device-key': 'phone-key' } },
    });
    await relay.setPush('p1', null);
    expect(asked.at(-1)!.init).toMatchObject({ method: 'PUT', body: JSON.stringify({ pushToken: null }) });
    await expect(relay.setPush('gone', null)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lists confirmed pairings as computers, from the relay the server names', async () => {
    const { relay, asked } = setup();
    expect(await relay.listComputers()).toEqual([{ id: 'p1', name: 'laptop', os: 'macos', lastSeenAt: '2026-11-19T08:00:00.000Z', online: true, verified: true, push: true, hostId: 'h' }]);
    const pairings = asked.find((a) => a.url.endsWith('/pairings'))!;
    expect(pairings.url).toBe('https://relay.example.test/pairings');
    expect(pairings.init!.headers).toMatchObject({ authorization: 'Bearer bearer-1', 'x-device-key': 'phone-key' });
    await expect(relay.pair('ABCD2345', 'phone')).rejects.toMatchObject({ code: 'not_found' });
    expect(asked.find(a => a.url.endsWith('/pair'))!.init!.headers).toMatchObject({ 'x-device-key': 'phone-key' });
  });

  it('lists the member’s own computers, paired or not, with the plugin’s version', async () => {
    const { relay, asked, setToken } = setup();
    expect(await relay.listHosts()).toEqual([
      { hostId: 'h', name: 'laptop', os: 'macos', online: true, lastSeenAt: '2026-11-19T08:00:00.000Z', dshVersion: '0.9.0', pluginVersion: '0.18.0', paired: true },
      // A pairing still waiting on the computer's approval is not one yet.
      { hostId: 'h2', name: 'desk', os: null, online: false, lastSeenAt: '2026-11-18T08:00:00.000Z', dshVersion: '0.8.0', pluginVersion: null, paired: false },
    ]);
    expect(asked.find((a) => a.url.endsWith('/hosts'))!.init!.headers).toMatchObject({ authorization: 'Bearer bearer-1', 'x-device-key': 'phone-key' });
    // A server from before the app could list computers refuses its Bearer: none, rather than a failure.
    setToken('old-server');
    expect(await relay.listHosts()).toEqual([]);
  });

  it('opens one socket to /phone, introduces the member, and lists sessions with those waiting on the member first', async () => {
    const { relay, socket, eventsReady } = setup();
    const listed = relay.listSessions('p1');
    const s = await socket();
    expect(s.url).toBe('wss://relay.example.test/phone');
    expect(s.sent[0]).toEqual({ t: 'hello', token: 'bearer-1', deviceKey: 'phone-key' });
    await eventsReady(s, 'p1', [
      { type: 'waterfall', event: 'user-questions/request', eventId: 'q-1', agentId: 's2', request: { questions: [{ id: 'go', question: 'Deploy?', options: [{ label: 'Yes' }] }] } },
    ]);
    await until(() => s.sent.some((f) => f.t === 'call'));
    const call = s.sent.find((f) => f.t === 'call');
    expect(call).toMatchObject({ pairingId: 'p1', method: 'session/list', body: { args: { _request: {} } } });
    s.push({
      t: 'result',
      pairingId: 'p1',
      id: call.id,
      status: 200,
      body: {
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: 's1', updatedAt: 2, title: 't', running: true, cwd: '/home/ada/app' },
              { sessionId: 's2', updatedAt: 1, title: 't', running: false, cwd: '/home/ada/site/' },
            ],
          },
        },
      },
    });
    expect(await listed).toEqual([
      { id: 's2', title: '', status: 'idle', updatedAt: new Date(1).toISOString(), directory: 'site', pending: { kind: 'question', id: 'q-1#0', question: 'Deploy?', options: [{ id: 'Yes', label: 'Yes' }] }, step: null, marks: null },
      { id: 's1', title: '', status: 'running', updatedAt: new Date(2).toISOString(), directory: 'app', pending: null, step: null, marks: null },
    ]);
  });

  it('turns the relay’s refusals into the screens’ errors', async () => {
    const { relay, socket, eventsReady } = setup();
    const listed = relay.listSessions('gone');
    const s = await socket();
    await eventsReady(s, 'gone');
    await until(() => s.sent.some((f) => f.t === 'call'));
    s.push({ t: 'error', pairingId: 'gone', id: s.sent.find((f) => f.t === 'call').id, error: 'not_paired' });
    await expect(listed).rejects.toEqual(new RelayError('not_found'));
  });

  it('follows a session, shows the question the agent asks, and answers it through $events', async () => {
    const { relay, socket } = setup();
    const seen: SessionEvent[] = [];
    // The sessions tab answers in place too, so it reads its list again after each answer.
    const listChanged = vi.fn();
    relay.watchSessions('p1', listChanged);
    relay.follow('p1', 's1', (e) => seen.push(e));
    const s = await socket();
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 2);
    const [events, follow] = s.sent.filter((f) => f.t === 'mux').map((f) => f.body);
    expect(events).toMatchObject({ type: 'open', endpoint: '$events' });
    expect(follow).toMatchObject({ type: 'open', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 's1' }, activate: true } } } });

    s.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: events.streamId, value: { type: 'ready', clientId: 'c-1' } } });
    s.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: follow.streamId, value: { type: 'snapshot', records: [], cursor: 0 } } });
    s.push({
      t: 'mux',
      pairingId: 'p1',
      body: {
        type: 'item',
        streamId: events.streamId,
        value: {
          type: 'waterfall',
          event: 'user-questions/request',
          eventId: 'q-1',
          agentId: 's1',
          request: {
            questions: [
              { id: 'go', question: 'Deploy?', options: [{ label: 'Yes' }, { label: 'No' }] },
              { id: 'where', question: 'Where?', options: [{ label: 'Staging' }] },
            ],
          },
        },
      },
    });
    expect(seen.at(-1)).toMatchObject({ type: 'pending', pending: { kind: 'question', id: 'q-1#0', question: 'Deploy?' } });

    // A batch is asked one question at a time; nothing is sent until the last answer.
    await relay.answer('p1', 's1', 'q-1#0', { kind: 'question', optionId: 'Yes' });
    expect(seen.at(-1)).toMatchObject({ type: 'pending', pending: { id: 'q-1#1', question: 'Where?' } });
    listChanged.mockClear();
    expect(s.sent.some((f) => f.method === '$events/result')).toBe(false);

    const answered = relay.answer('p1', 's1', 'q-1#1', { kind: 'question', optionId: 'Staging' });
    await until(() => s.sent.some((f) => f.method === '$events/result'));
    const result = s.sent.find((f) => f.method === '$events/result');
    expect(result.body.args).toEqual({ clientId: 'c-1', eventId: 'q-1', outcome: { kind: 'result', value: { answers: [{ id: 'go', selected: ['Yes'] }, { id: 'where', selected: ['Staging'] }] } } });
    s.push({ t: 'result', pairingId: 'p1', id: result.id, status: 200, body: { result: { ok: true } } });
    await answered;
    expect(seen.at(-1)).toEqual({ type: 'pending', pending: null });
    expect(listChanged).toHaveBeenCalled();
    await expect(relay.answer('p1', 's1', 'q-1#1', { kind: 'question', optionId: 'Staging' })).rejects.toMatchObject({ code: 'stale' });
  });

  it('shows a question asked before the phone connected, which DSH replays to a new $events stream', async () => {
    const { relay, socket } = setup();
    const seen: SessionEvent[] = [];
    relay.follow('p1', 's1', (e) => seen.push(e));
    const s = await socket();
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 2);
    const [events, follow] = s.sent.filter((f) => f.t === 'mux').map((f) => f.body);
    // DSH sends the still-waiting question as soon as the stream is ready, before the session's snapshot.
    s.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: events.streamId, value: { type: 'ready', clientId: 'c-1' } } });
    s.push({
      t: 'mux',
      pairingId: 'p1',
      body: { type: 'item', streamId: events.streamId, value: { type: 'waterfall', event: 'user-questions/request', eventId: 'q-0', agentId: 's1', request: { questions: [{ id: 'go', question: 'Deploy?', options: [{ label: 'Yes' }] }] } } },
    });
    s.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: follow.streamId, value: { type: 'snapshot', records: [], cursor: 0 } } });
    const snapshot = seen.find((e) => e.type === 'snapshot');
    expect(snapshot).toMatchObject({ state: { pending: { kind: 'question', id: 'q-0#0', question: 'Deploy?' } } });
  });

  it('reads the history before a snapshot that did not reach the session’s start, and stops at its start', async () => {
    const { relay, socket } = setup();
    const seen: SessionEvent[] = [];
    relay.follow('p1', 's1', (e) => seen.push(e));
    const s = await socket();
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 2);
    const [events, follow] = s.sent.filter((f) => f.t === 'mux').map((f) => f.body);
    s.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: events.streamId, value: { type: 'ready', clientId: 'c-1' } } });
    const said = (seq: number, text: string) => ({ type: 'event', event: { type: 'user/message', seq, data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } } });
    s.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: follow.streamId, value: { type: 'snapshot', records: [said(40, 'latest')], cursor: 40, hasMore: true } } });
    expect(seen.at(-1)).toMatchObject({ type: 'snapshot', state: { earlier: 40 } });

    const reading = relay.older('p1', 's1');
    await until(() => s.sent.some((f) => f.method === 'session/page'));
    const page = s.sent.find((f) => f.method === 'session/page');
    expect(page.body.args).toEqual({ request: { address: { kind: 'session', sessionId: 's1' }, beforeSeq: 40, maxMessages: 50 } });
    s.push({ t: 'result', pairingId: 'p1', id: page.id, status: 200, body: { result: { ok: true, value: { records: [said(3, 'first')], hasMore: false, cursor: 40 } } } });
    await reading;
    expect(seen.at(-1)).toEqual({ type: 'older', items: [{ kind: 'user', id: 'seq-3', text: 'first' }], earlier: null });

    // At its start there is nothing more to read.
    await relay.older('p1', 's1');
    expect(s.sent.filter((f) => f.method === 'session/page')).toHaveLength(1);
  });

  it('follows again on a new socket after the old one drops, from a fresh snapshot', async () => {
    const { relay, socket } = setup();
    const seen: SessionEvent[] = [];
    relay.follow('p1', 's1', (e) => seen.push(e));
    const s = await socket();
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 2);
    s.close();
    expect(seen.at(-1)).toEqual({ type: 'closed', reason: 'unavailable' });

    // The first retry waits a second, then opens a socket of its own.
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS[0]! + 50));
    await until(() => FakeSocket.made.length > 1 && FakeSocket.made[1]!.sent.length > 0);
    const next = FakeSocket.made[1]!;
    next.push({ t: 'welcome' });
    await until(() => next.sent.filter((f) => f.t === 'mux').length >= 2);
    const [events, follow] = next.sent.filter((f) => f.t === 'mux').map((f) => f.body);
    expect(follow).toMatchObject({ type: 'open', endpoint: 'session/follow', payload: { args: { request: { address: { sessionId: 's1' } } } } });
    next.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: events.streamId, value: { type: 'ready', clientId: 'c-2' } } });
    next.push({ t: 'mux', pairingId: 'p1', body: { type: 'item', streamId: follow.streamId, value: { type: 'snapshot', records: [], cursor: 0 } } });
    expect(seen.at(-1)).toMatchObject({ type: 'snapshot', state: { closed: null } });
  });

  it('does not follow again a session whose pairing was revoked, nor after sign-out', async () => {
    const { relay, socket } = setup();
    const seen: SessionEvent[] = [];
    relay.follow('p1', 's1', (e) => seen.push(e));
    const s = await socket();
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 2);
    s.push({ t: 'revoked', pairingId: 'p1' });
    const other: SessionEvent[] = [];
    relay.follow('p1', 's2', (e) => other.push(e));
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 4);
    relay.reset();
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS[0]! + 50));
    expect(FakeSocket.made).toHaveLength(1);
    expect(seen.at(-1)).toEqual({ type: 'closed', reason: 'not_found' });
    expect(other.at(-1)).toEqual({ type: 'closed', reason: 'not_found' });
  });

  it('ends a follow when its pairing is revoked or its computer goes away', async () => {
    const { relay, socket } = setup();
    const seen: SessionEvent[] = [];
    relay.follow('p1', 's1', (e) => seen.push(e));
    const s = await socket();
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 2);
    s.push({ t: 'revoked', pairingId: 'p1' });
    expect(seen.at(-1)).toEqual({ type: 'closed', reason: 'not_found' });

    const later: SessionEvent[] = [];
    relay.follow('p1', 's2', (e) => later.push(e));
    await until(() => s.sent.filter((f) => f.t === 'mux').length >= 4);
    s.push({ t: 'offline', pairingId: 'p1' });
    expect(later.at(-1)).toEqual({ type: 'closed', reason: 'offline' });
  });

  it('starts a session in the latest folder, and says so when the computer has none', async () => {
    const { relay, socket } = setup();
    const created = relay.createSession('p1');
    const s = await socket();
    await until(() => s.sent.some((f) => f.method === 'session/list'));
    const list = s.sent.find((f) => f.method === 'session/list');
    s.push({ t: 'result', pairingId: 'p1', id: list.id, status: 200, body: { result: { ok: true, value: { items: [{ sessionId: 'old', cwd: '/home/ada/app', updatedAt: 5 }] } } } });
    await answerDirectories(s, 'p1', ['/srv/project']);
    await until(() => s.sent.some((f) => f.method === 'session/create'));
    const create = s.sent.find((f) => f.method === 'session/create');
    expect(create.body.args).toEqual({ request: { cwd: '/home/ada/app' } });
    s.push({ t: 'result', pairingId: 'p1', id: create.id, status: 200, body: { result: { ok: true, value: { sessionId: 'new-1' } } } });
    expect(await created).toEqual({ id: 'new-1', directory: 'app' });

    const none = relay.createSession('p2');
    await until(() => s.sent.filter((f) => f.method === 'session/list').length > 1);
    const second = s.sent.filter((f) => f.method === 'session/list')[1];
    s.push({ t: 'result', pairingId: 'p2', id: second.id, status: 200, body: { result: { ok: true, value: { items: [] } } } });
    await answerDirectories(s, 'p2', []);
    await expect(none).rejects.toMatchObject({ code: 'no_directory' });
  });

  it('starts a member new to a shared DSH where the computer offers, and nowhere it does not', async () => {
    const { relay, socket } = setup();
    const created = relay.createSession('p1');
    const s = await socket();
    await until(() => s.sent.some((f) => f.method === 'session/list'));
    const list = s.sent.find((f) => f.method === 'session/list');
    s.push({ t: 'result', pairingId: 'p1', id: list.id, status: 200, body: { result: { ok: true, value: { items: [] } } } });
    await answerDirectories(s, 'p1', ['/srv/project', '/srv/docs']);
    await until(() => s.sent.some((f) => f.method === 'session/create'));
    const create = s.sent.find((f) => f.method === 'session/create');
    expect(create.body.args).toEqual({ request: { cwd: '/srv/project' } });
    s.push({ t: 'result', pairingId: 'p1', id: create.id, status: 200, body: { result: { ok: true, value: { sessionId: 'new-2' } } } });
    expect(await created).toEqual({ id: 'new-2', directory: 'project' });

    const elsewhere = relay.createSession('p1', { cwd: '/etc' });
    await until(() => s.sent.filter((f) => f.method === 'session/list').length > 1);
    const again = s.sent.filter((f) => f.method === 'session/list')[1];
    s.push({ t: 'result', pairingId: 'p1', id: again.id, status: 200, body: { result: { ok: true, value: { items: [] } } } });
    await answerDirectories(s, 'p1', ['/srv/project'], 1);
    await expect(elsewhere).rejects.toMatchObject({ code: 'invalid_directory' });
  });

  it('starts a session for a team in that team’s default workspace, ahead of the latest folder', async () => {
    const { relay, socket } = setup();
    const created = relay.createSession('p1', { teamId: 't' });
    const s = await socket();
    await until(() => s.sent.some((f) => f.method === 'session/list'));
    const list = s.sent.find((f) => f.method === 'session/list');
    s.push({ t: 'result', pairingId: 'p1', id: list.id, status: 200, body: { result: { ok: true, value: { items: [{ sessionId: 'old', cwd: '/home/ada/app', updatedAt: 5 }] } } } });
    await answerDirectories(s, 'p1', ['/home/ada', '/srv/team'], 0, { t: '/srv/team', other: '/home/ada' });
    await until(() => s.sent.some((f) => f.method === 'session/create'));
    const create = s.sent.find((f) => f.method === 'session/create');
    expect(create.body.args).toEqual({ request: { cwd: '/srv/team' } });
    s.push({ t: 'result', pairingId: 'p1', id: create.id, status: 200, body: { result: { ok: true, value: { sessionId: 'new-t' } } } });
    expect(await created).toEqual({ id: 'new-t', directory: 'team' });
    relay.reset();
  });

  it('creates in the exact known folder and native preset selected on the phone', async () => {
    const { relay, socket } = setup();
    const creating = relay.createSession('p1', {cwd:'/other/site',agentPreset:'team:t:review'});
    const s=await socket();
    await until(()=>s.sent.some(f=>f.method==='session/list'));
    const list=s.sent.find(f=>f.method==='session/list');
    s.push({t:'result',pairingId:'p1',id:list.id,status:200,body:{result:{ok:true,value:{items:[{cwd:'/old/site',updatedAt:3},{cwd:'/other/site',updatedAt:1}]}}}});
    await answerDirectories(s, 'p1', []);
    await until(()=>s.sent.some(f=>f.method==='session/create'));
    const create=s.sent.find(f=>f.method==='session/create');
    expect(create.body.args.request).toEqual({cwd:'/other/site',agentPreset:'team:t:review'});
    s.push({t:'result',pairingId:'p1',id:create.id,status:200,body:{result:{ok:true,value:{sessionId:'new'}}}});
    expect(await creating).toEqual({id:'new',directory:'site'});
    relay.reset();
  });

  it('uses the session-only model method and preserves a structured readiness refusal', async () => {
    const { relay, socket }=setup();
    const changing=relay.selectModel('p1','s1',{provider:'p',model:'m',reasoningEffort:'high'});
    const s=await socket();
    await until(()=>s.sent.some(f=>f.method==='teamwork/selectModel'));
    const change=s.sent.find(f=>f.method==='teamwork/selectModel');
    expect(change.body.args.request).toEqual({sessionId:'s1',provider:'p',model:'m',reasoningEffort:'high'});
    s.push({t:'result',pairingId:'p1',id:change.id,status:200,body:{result:{ok:true,value:{selected:{provider:'p',model:'m',reasoningEffort:'high'}}}}});
    expect(await changing).toMatchObject({model:'m',reasoningEffort:'high'});
    const submitting=relay.prompt('p1','s1','hello');
    const rejected=expect(submitting).rejects.toMatchObject({code:'missing_tools'});
    await until(()=>s.sent.some(f=>f.method==='session/prompt'));
    const prompt=s.sent.find(f=>f.method==='session/prompt');
    s.push({t:'result',pairingId:'p1',id:prompt.id,status:200,body:{result:{ok:false,error:{code:'teamwork/missing_tools'}}}});
    await rejected;
    relay.reset();
  });
});

describe('joining a shared DSH', () => {
  function joining(answer: 'pairAccepted' | 'joinRefused') {
    FakeSocket.made = [];
    FakeSocket.quiet = true;
    const trusted: string[] = [];
    const request = (async (url: string) => {
      if (url.endsWith('/api/relay')) return new Response(JSON.stringify({ url: 'wss://relay.example.test/plugin', push: true }));
      if (url.endsWith('/shared/h1/join')) return new Response(JSON.stringify({ pairing: { id: 'j1', hostId: 'h1', hostName: 'build box', status: 'pending' } }), { status: 201 });
      if (url.endsWith('/shared/h2/join')) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const relay = createLiveRelay({
      keys: { relayKey: async () => 'phone-key', identity: async () => ({} as any), peer: async () => undefined, trust: async (id: string) => { trusted.push(id); }, forget: async () => {} },
      random: (n) => new Uint8Array(n).fill(1), session: async () => ({ server: 'https://teamwork.example.test', token: 't' }), locale: () => 'en', device: 'android', request,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    // The DSH answers the invite once it arrives inside the channel.
    void (async () => {
      await until(() => FakeSocket.made.length > 0 && FakeSocket.made[0]!.sent.length > 0);
      const s = FakeSocket.made[0]!;
      s.push({ t: 'welcome' });
      await until(() => s.sent.some((f) => f.t === 'shareJoin'));
      s.onmessage?.({ data: JSON.stringify({ t: 'sealed', pairingId: 'j1', channelId: s.channels.get('j1'), kind: 'data', data: JSON.stringify({ t: answer }) }) });
    })();
    return { relay, trusted, sent: () => FakeSocket.made[0]!.sent };
  }
  const invite = { host: 'h1', key: 'dsh-key', invite: 'inv1', secret: 's3cr3t' };

  it('hands the invite over inside the channel and trusts the DSH once it accepts', async () => {
    const { relay, trusted, sent } = joining('pairAccepted');
    const pairing = await relay.join(invite, 'phone');
    expect(pairing).toMatchObject({ id: 'j1', hostName: 'build box', status: 'confirmed' });
    expect(sent().find((f) => f.t === 'shareJoin')).toEqual({ t: 'shareJoin', invite: 'inv1', secret: 's3cr3t', name: 'phone', kind: 'android' });
    expect(sent().some((f) => f.t === 'pairHello')).toBe(false);
    expect(trusted).toEqual(['j1']);
  });

  it('says so when the DSH refuses the invite, or the member may not reach it', async () => {
    const { relay, trusted } = joining('joinRefused');
    await expect(relay.join(invite, 'phone')).rejects.toMatchObject({ code: 'invite_refused' });
    expect(trusted).toEqual([]);
    await expect(relay.join({ ...invite, host: 'h2' }, 'phone')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('a computer\'s PIN lock', () => {
  it('follows what the computer says, sends the PIN inside the channel, and reads a locked call as locked', async () => {
    const { relay, socket, eventsReady } = setup();
    const states: unknown[] = [];
    relay.watchPin('p1', (state) => states.push(state));
    const listing = relay.listSessions('p1');
    const s = await socket();
    await until(() => s.channels.has('p1'));
    const say = (value: unknown) => s.onmessage?.({ data: JSON.stringify({ t: 'sealed', pairingId: 'p1', channelId: s.channels.get('p1'), kind: 'data', data: JSON.stringify(value) }) });
    say({ t: 'pinRequired', set: false });
    expect(states.at(-1)).toEqual({ kind: 'required', set: false });
    await eventsReady(s, 'p1');
    await until(() => s.sent.some((f) => f.t === 'call' && f.method === 'session/list'));
    const { id } = s.sent.find((f) => f.t === 'call' && f.method === 'session/list');
    s.push({ t: 'result', pairingId: 'p1', id, status: 200, body: { result: { ok: false, error: { code: 'teamwork/locked' } } } });
    await expect(listing).rejects.toMatchObject({ code: 'locked' });

    const unlocking = relay.unlock('p1', '2468');
    await until(() => s.sent.some((f) => f.t === 'unlock'));
    expect(s.sent.find((f) => f.t === 'unlock')).toEqual({ t: 'unlock', pin: '2468' });
    say({ t: 'pinWrong', left: 3 });
    expect(await unlocking).toEqual({ kind: 'wrong', left: 3 });
    const setting = relay.setPin('p1', '1357', '2468');
    await until(() => s.sent.some((f) => f.t === 'setPin'));
    expect(s.sent.find((f) => f.t === 'setPin')).toEqual({ t: 'setPin', pin: '1357', old: '2468' });
    say({ t: 'unlocked' });
    expect(await setting).toEqual({ kind: 'unlocked' });
    expect(states.at(-1)).toEqual({ kind: 'unlocked' });
  });
});
