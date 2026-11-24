/**
 * A computer's sessions over a link that is not the relay, as an edition's server may bring: calls and streams are
 * the link's, the state the screens follow is the module's, and a link that drops a computer's streams retries them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeValue, createDshSessions, RETRY_MS, type DshLink } from '../dsh-sessions';
import { RelayError, type SessionEvent } from '../types';
import { applySessionEvent, EMPTY_SESSION } from '../session';
import { base64 } from '../secure-channel';
import { chunks } from './markdown-fixture.json';

function fakeLink() {
  const calls: Array<{ computerId: string; method: string; args: unknown }> = [];
  const opened: Array<{ computerId: string; endpoint: string; streamId: string; onBody: (body: Record<string, unknown>) => void }> = [];
  const closed: Array<{ streamId: string; cancel: boolean }> = [];
  let n = 0;
  const link: DshLink = {
    async call(computerId, method, args) {
      calls.push({ computerId, method, args });
      if (method === 'session/list') return { items: [{ sessionId: 's1', cwd: '/home/user/work', running: false, updatedAt: 1, projections: { values: { title: 'Fix it' } } }] };
      if (method === '$events/result' || method === 'session/cancel') return {};
      if (method === 'session/rename') return { title: 'Release notes', seq: 4 };
      if (method === 'teamwork/selectPermission') return { current: 'read-only' };
      if (method === 'teamwork/listFiles') return { path: '', entries: [{ name: 'src', kind: 'directory' }], truncated: false };
      if (method === 'teamwork/readFile') return { path: 'a.md', text: 'hi', bytes: 2, truncated: false };
      if (method.startsWith('workspace/')) return {};
      throw new RelayError('configuration_unsupported');
    },
    async open(computerId, endpoint, _args, onBody) {
      const streamId = `st${++n}`;
      opened.push({ computerId, endpoint, streamId, onBody });
      if (endpoint === '$events') onBody({ type: 'item', streamId, value: { type: 'ready', clientId: 'client-1' } });
      return streamId;
    },
    close(_computerId, streamId, cancel) { closed.push({ streamId, cancel }); },
  };
  return { link, calls, opened, closed };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('a computer\'s sessions over any link', () => {
  it('lists, follows and answers through the link alone', async () => {
    const { link, calls, opened } = fakeLink();
    const sessions = createDshSessions(link, { locale: () => 'en', nextId: () => 'id' });
    const listed = await sessions.listSessions('cloud');
    expect(listed.map((s) => s.id)).toEqual(['s1']);
    expect(opened.map((o) => o.endpoint)).toEqual(['$events']);

    const seen: SessionEvent[] = [];
    const stop = sessions.follow('cloud', 's1', (event) => seen.push(event));
    await tick();
    const follow = opened.find((o) => o.endpoint === 'session/follow')!;
    follow.onBody({ type: 'item', streamId: follow.streamId, value: { type: 'snapshot', cursor: 0, hasMore: false, records: [] } });
    expect(seen.map((e) => e.type)).toEqual(['snapshot']);

    // The agent asks for an approval on the computer's $events; the answer goes back under its client id.
    const events = opened.find((o) => o.endpoint === '$events')!;
    events.onBody({ type: 'item', streamId: events.streamId, value: { type: 'waterfall', eventId: 'e1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', reason: 'run it' } } });
    expect(seen.at(-1)).toEqual({ type: 'pending', pending: { kind: 'approval', id: 'e1', title: 'bash', detail: 'run it' } });
    await sessions.answer('cloud', 's1', 'e1', { kind: 'approval', approve: true });
    expect(calls.at(-1)).toMatchObject({ method: '$events/result', args: { clientId: 'client-1', eventId: 'e1' } });
    expect(seen.at(-1)).toEqual({ type: 'pending', pending: null });
    stop();
  });

  it('closes a follow when the link drops the computer, and opens it again after a wait', async () => {
    vi.useFakeTimers();
    const { link, opened, closed } = fakeLink();
    const sessions = createDshSessions(link, { locale: () => 'en', nextId: () => 'id' });
    const seen: SessionEvent[] = [];
    sessions.follow('cloud', 's1', (event) => seen.push(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(opened.filter((o) => o.endpoint === 'session/follow')).toHaveLength(1);

    sessions.ended('cloud', 'offline');
    expect(seen.at(-1)).toEqual({ type: 'closed', reason: 'offline' });
    expect(closed.every((c) => !c.cancel)).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]! + 10);
    expect(opened.filter((o) => o.endpoint === 'session/follow')).toHaveLength(2);
  });

  it('continues a streamed Markdown reply from a compact baseline and replays the stopped reply once', async () => {
    vi.useFakeTimers();
    const { link, opened, calls } = fakeLink();
    const attemptId = 'markdown-attempt';
    const start = { type: 'turn/start', seq: 1, data: { turn: 1 } };
    const draft = (count: number) => ({
      type: 'snapshot',
      records: [{ event: start }],
      assistantStream: { activeAttempt: { attemptId, turn: 1, step: 1, nextIndex: count,
        stream: [{ type: 'text-chunks', index: 0, time0: 1, dt: Array(count - 1).fill(1), texts: chunks.slice(0, count) }] } },
    });
    const full = chunks.join('');
    const stopped = { type: 'assistant/message', seq: 2, data: {
      turn: 1, step: 1, interrupted: true, message: { content: [{ type: 'text', text: full }] },
    } };
    const end = { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'aborted' } } };
    const send = (follow: (typeof opened)[number], value: Record<string, unknown>) => follow.onBody({ type: 'item', value });
    const delta = (index: number) => ({
      type: 'assistant-stream', frame: { type: 'chunk', attemptId, index, chunk: { type: 'text-delta', text: chunks[index] } },
    });
    let openedFollows = 0;
    const sessions = createDshSessions({
      ...link,
      async open(computerId, endpoint, args, onBody) {
        const result = link.open(computerId, endpoint, args, onBody);
        if (endpoint === 'session/follow') {
          const snapshots = [draft(1), draft(3), { type: 'snapshot', records: [start, stopped, end].map((event) => ({ event })) }];
          onBody({ type: 'item', value: snapshots[openedFollows++] });
        }
        return result;
      },
    }, { locale: () => 'en', nextId: () => 'id' });
    let state = EMPTY_SESSION;
    const unfollow = sessions.follow('cloud', 's1', (event) => { state = applySessionEvent(state, event); });
    const advance = async (ms = 0) => vi.advanceTimersByTimeAsync(ms);
    const follows = () => opened.filter((stream) => stream.endpoint === 'session/follow');
    await advance();
    expect(state.items).toEqual([{ kind: 'assistant', id: 'assistant-1-1', streaming: true, text: chunks[0] }]);
    send(follows()[0]!, delta(1));
    expect(state.items[0]).toMatchObject({ text: chunks.slice(0, 2).join('') });

    sessions.ended('cloud', 'offline');
    expect(state.closed).toBe('offline');
    expect(state.items[0]).toMatchObject({ text: chunks.slice(0, 2).join('') });
    await advance(RETRY_MS[0]!);
    expect(state.closed).toBeNull();
    send(follows()[0]!, delta(3)); // An old stream cannot append into the new one.
    expect(state.items[0]).toMatchObject({ text: chunks.slice(0, 3).join('') });
    send(follows()[1]!, delta(3));
    expect(state.items[0]).toMatchObject({ streaming: true, text: full });

    await sessions.cancel('cloud', 's1');
    expect(calls.at(-1)).toMatchObject({ method: 'session/cancel', args: { request: { sessionId: 's1' } } });
    send(follows()[1]!, { type: 'event', event: stopped });
    send(follows()[1]!, delta(3)); // A late delta cannot change durable text.
    send(follows()[1]!, { type: 'assistant-stream', frame: { type: 'end', attemptId, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 2 } } });
    send(follows()[1]!, { type: 'event', event: end });
    const settled = { kind: 'assistant', id: 'assistant-1-1', interrupted: true, text: full };
    const items = [settled, { kind: 'turn-end', id: 'turn-end-1', turn: 1, completed: false }];
    expect(state).toMatchObject({ status: 'idle', items });

    sessions.ended('cloud', 'offline');
    await advance(RETRY_MS[0]!);
    expect(state).toMatchObject({ status: 'idle', closed: null, items });
    unfollow();
  });

  it('reads a text file a page at a time, asks for what a turn changed, and passes on missing fonts', async () => {
    const { link } = fakeLink();
    const call = vi.fn<DshLink['call']>(async (_computer, method, args) => {
      const request = (args as { request: Record<string, unknown> }).request;
      if (method === 'teamwork/readFile') {
        return request.offset ? { path: 'a.md', text: 'tail', bytes: 8, truncated: false, offset: 4, version: 'v1' }
          : { path: 'a.md', text: 'head', bytes: 8, truncated: true, offset: 0, next: 4, version: 'v1' };
      }
      if (method === 'teamwork/changes') return { turn: 2, total: 1, added: 3, deleted: 1, files: [{ path: 'a.md', display: 'a.md', added: 3, deleted: 1 }] };
      if (method === 'teamwork/readDocument') return { offset: 0, size: 3, version: 'r', data: base64(new Uint8Array([1, 2, 3])), missingFonts: ['Microsoft YaHei'] };
      throw new Error(method);
    });
    const sessions = createDshSessions({ ...link, call }, { locale: () => 'en', nextId: () => 'id' });
    const head = await sessions.readFile('c', 's1', 'a.md');
    expect(head).toMatchObject({ text: 'head', next: 4, version: 'v1' });
    expect(await sessions.readFile('c', 's1', 'a.md', { offset: head.next!, version: head.version! })).toMatchObject({ text: 'tail' });
    expect(call).toHaveBeenLastCalledWith('c', 'teamwork/readFile', { request: { sessionId: 's1', path: 'a.md', offset: 4, version: 'v1' } });
    expect(await sessions.turnChanges('c', 's1', 9)).toMatchObject({ turn: 2, added: 3, files: [{ display: 'a.md' }] });
    expect(call).toHaveBeenLastCalledWith('c', 'teamwork/changes', { request: { sessionId: 's1', seq: 9 } });
    expect((await sessions.readDocument('c', 's1', 'deck.pptx')).missingFonts).toEqual(['Microsoft YaHei']);
  });

  it('reassembles PDF ranges, rejects changed versions, and stops reading after cancellation', async () => {
    const { link } = fakeLink();
    const full = new Uint8Array(128 * 1024 + 5).fill(32);
    full.set([37, 80, 68, 70]);
    const call = vi.fn<DshLink['call']>();
    call.mockImplementation(async (_computer, method, args) => {
      expect(method).toBe('teamwork/readDocument');
      const { offset, version } = (args as { request: { offset: number; version?: string } }).request;
      expect(version).toBe(offset ? 'stable' : undefined);
      return { offset, size: full.length, version: 'stable', data: base64(full.subarray(offset, offset + 128 * 1024)) };
    });
    const sessions = createDshSessions({ ...link, call }, { locale: () => 'en', nextId: () => 'id' });
    const { bytes: received, missingFonts } = await sessions.readDocument('cloud', 's1', 'report.pdf');
    expect(received).toHaveLength(full.length);
    expect(received.every((byte, index) => byte === full[index])).toBe(true);
    expect(missingFonts).toEqual([]);
    expect(call).toHaveBeenCalledTimes(2);

    const controller = new AbortController();
    call.mockImplementationOnce(async () => {
      controller.abort();
      return { offset: 0, size: full.length, version: 'stable', data: base64(full.subarray(0, 128 * 1024)) };
    });
    await expect(sessions.readDocument('cloud', 's1', 'report.pdf', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(call).toHaveBeenCalledTimes(3);

    call.mockImplementationOnce(async () => ({ offset: 0, size: full.length, version: 'stable', data: base64(full.subarray(0, 128 * 1024)) }));
    call.mockImplementationOnce(async () => ({ offset: 128 * 1024, size: full.length, version: 'changed', data: base64(full.subarray(128 * 1024)) }));
    await expect(sessions.readDocument('cloud', 's1', 'report.pdf')).rejects.toMatchObject({ code: 'unavailable' });

    // A plugin from before previews refuses the method: the reader is told to update it.
    call.mockImplementationOnce(async () => bridgeValue(403, { error: 'method_not_allowed' }));
    await expect(sessions.readDocument('cloud', 's1', 'report.pdf')).rejects.toMatchObject({ code: 'preview_unsupported' });
    call.mockImplementationOnce(async () => bridgeValue(200, { result: { ok: false, error: { code: 'teamwork/document_empty' } } }));
    await expect(sessions.readDocument('cloud', 's1', 'empty.pdf')).rejects.toMatchObject({ code: 'document_empty' });
  });

  it('reads a bridge answer as its value or the refusal it means', () => {
    expect(bridgeValue(200, { result: { ok: true, value: 7 } })).toBe(7);
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'session/agent-busy' } } })).toThrow(new RelayError('busy'));
    expect(() => bridgeValue(403, { error: 'method_not_allowed' })).toThrow(new RelayError('configuration_unsupported'));
    expect(() => bridgeValue(502, null)).toThrow(new RelayError('unavailable'));
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'teamwork/stale' } } })).toThrow(new RelayError('stale'));
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'workspace/session-active' } } })).toThrow(new RelayError('busy'));
  });

  it('renames, pins and archives through DSH\'s own calls, and tells the lists watching to read themselves again', async () => {
    const { link, calls } = fakeLink();
    const sessions = createDshSessions(link, { locale: () => 'en', nextId: () => 'id' });
    let changed = 0;
    const unwatch = sessions.watchSessions('c', () => changed++);
    await tick();
    const before = changed;
    expect(await sessions.renameSession('c', 's1', '  Release notes ')).toBe('Release notes');
    await sessions.pinSession('c', 's1', true);
    await sessions.pinSession('c', 's1', false);
    await sessions.archiveSession('c', 's1', true);
    await sessions.archiveSession('c', 's1', false);
    expect(calls.slice(-5).map((c) => [c.method, c.args])).toEqual([
      ['session/rename', { request: { sessionId: 's1', title: '  Release notes ' } }],
      ['workspace/pinSession', { request: { sessionId: 's1' } }],
      ['workspace/unpinSession', { request: { sessionId: 's1' } }],
      ['workspace/archiveSession', { request: { sessionId: 's1' } }],
      ['workspace/unarchiveSession', { request: { sessionId: 's1' } }],
    ]);
    expect(changed - before).toBe(5);
    expect(await sessions.selectPermission('c', 's1', 'read-only')).toBe('read-only');
    expect(calls.at(-1)).toMatchObject({ method: 'teamwork/selectPermission', args: { request: { sessionId: 's1', preset: 'read-only' } } });
    expect((await sessions.listFiles('c', 's1', '')).entries).toEqual([{ name: 'src', kind: 'directory' }]);
    expect(calls.at(-1)).toMatchObject({ method: 'teamwork/listFiles', args: { request: { sessionId: 's1', path: '' } } });
    expect((await sessions.readFile('c', 's1', 'a.md')).text).toBe('hi');
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'teamwork/not_text' } } })).toThrow(new RelayError('not_text'));
    unwatch();
  });
});
