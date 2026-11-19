/**
 * A computer's sessions over a link that is not the relay, as an edition's server may bring: calls and streams are
 * the link's, the state the screens follow is the module's, and a link that drops a computer's streams retries them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeValue, createDshSessions, RETRY_MS, type DshLink } from '../dsh-sessions';
import { RelayError, type SessionEvent } from '../types';

function fakeLink() {
  const calls: Array<{ computerId: string; method: string; args: unknown }> = [];
  const opened: Array<{ computerId: string; endpoint: string; streamId: string; onBody: (body: Record<string, unknown>) => void }> = [];
  const closed: Array<{ streamId: string; cancel: boolean }> = [];
  let n = 0;
  const link: DshLink = {
    async call(computerId, method, args) {
      calls.push({ computerId, method, args });
      if (method === 'session/list') return { items: [{ sessionId: 's1', cwd: '/home/user/work', running: false, updatedAt: 1, projections: { values: { title: 'Fix it' } } }] };
      if (method === '$events/result') return {};
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

  it('reads a bridge answer as its value or the refusal it means', () => {
    expect(bridgeValue(200, { result: { ok: true, value: 7 } })).toBe(7);
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'session/agent-busy' } } })).toThrow(new RelayError('busy'));
    expect(() => bridgeValue(403, { error: 'method_not_allowed' })).toThrow(new RelayError('configuration_unsupported'));
    expect(() => bridgeValue(502, null)).toThrow(new RelayError('unavailable'));
    expect(() => bridgeValue(200, { result: { ok: false, error: { code: 'teamwork/stale' } } })).toThrow(new RelayError('stale'));
  });
});
