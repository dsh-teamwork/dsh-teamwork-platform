import { describe, expect, it } from 'vitest';
import { answerRelayed, EMPTY_RELAYED_SESSION, receiveRelayed, relayedPending, withoutRelayedEvent, type RelayedFrame, type RelayedSession } from '../relayed';

const S = 'session-1';
const replay = (frames: RelayedFrame[]) => frames.reduce<RelayedSession>((f, frame) => receiveRelayed(f, frame, 'en'), EMPTY_RELAYED_SESSION);
const text = (t: string) => [{ type: 'text', text: t }];
const snapshot: RelayedFrame = {
  stream: 'follow',
  value: {
    type: 'snapshot',
    header: { version: 4, id: S },
    records: [
      { type: 'event', event: { type: 'user/message', seq: 1, data: { content: text('Deploy it'), source: { kind: 'user' } } } },
      { type: 'event', event: { type: 'user/message', seq: 2, data: { content: text('Runtime context.'), source: { kind: 'runtime' } } } },
    ],
  },
};
const ready: RelayedFrame = { stream: 'events', value: { type: 'ready', clientId: 'client-1' } };
const ask: RelayedFrame = {
  stream: 'events',
  value: { type: 'waterfall', event: 'user-questions/request', eventId: 'e1', agentId: S, request: { questions: [{ id: 'a', question: 'Staging?', options: [{ label: 'Yes' }] }, { id: 'b', question: 'Notify?', options: [{ label: 'No' }] }] } },
};

describe('a session a server relays', () => {
  it('reads the snapshot, then committed events and the reply as it is written', () => {
    const followed = replay([
      snapshot,
      { stream: 'follow', value: { type: 'event', event: { type: 'turn/start', seq: 3, data: { turn: 1 } } } },
      { stream: 'follow', value: { type: 'assistant-stream', frame: { type: 'start', attemptId: 'x', turn: 1, step: 1 } } },
      { stream: 'follow', value: { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'x', chunk: { type: 'text-delta', index: 0, text: 'Deploy' } } } },
      { stream: 'follow', value: { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'x', chunk: { type: 'text-delta', index: 0, text: 'ing' } } } },
    ]);
    expect(followed.session).toBe(S);
    expect(followed.state.status).toBe('running');
    expect(followed.state.items.map((i) => (i.kind === 'tool' ? i.name : i.kind === 'page' ? i.page.title : i.text))).toEqual(['Deploy it', 'Deploying']);
  });

  it('asks a batch one question at a time, and answers it under the stream’s client id', () => {
    let followed = replay([snapshot, ready, ask, { ...ask, value: { ...(ask.value as object), eventId: 'e2', agentId: 'subagent' } }]);
    expect(relayedPending(followed)).toMatchObject({ kind: 'question', id: 'e1#0', question: 'Staging?' });
    const first = answerRelayed(followed, 'e1#0', { kind: 'question', optionId: 'Yes' });
    if (!first || !('next' in first)) throw new Error('the first answer should ask the next question');
    followed = first.next;
    expect(relayedPending(followed)).toMatchObject({ id: 'e1#1', question: 'Notify?' });
    expect(answerRelayed(followed, 'e1#1', { kind: 'question', optionId: 'No' })).toEqual({
      send: { clientId: 'client-1', eventId: 'e1', value: { answers: [{ id: 'a', selected: ['Yes'] }, { id: 'b', selected: ['No'] }] } },
    });
    expect(relayedPending(withoutRelayedEvent(followed, 'e1'))).toBeNull();
  });

  it('answers an approval with DSH’s outcome, and not with a question’s answer', () => {
    const approve: RelayedFrame = { stream: 'events', value: { type: 'waterfall', event: 'approval/request', eventId: 'e3', agentId: S, request: { toolName: 'Bash', reason: 'Run the deploy' } } };
    const followed = replay([snapshot, ready, approve]);
    expect(relayedPending(followed)).toMatchObject({ kind: 'approval', id: 'e3', title: 'Bash', detail: 'Run the deploy' });
    expect(answerRelayed(followed, 'e3', { kind: 'approval', approve: false })).toEqual({ send: { clientId: 'client-1', eventId: 'e3', value: 'rejected' } });
    expect(answerRelayed(followed, 'e3', { kind: 'question', optionId: 'Yes' })).toBeNull();
  });

  it('forgets what DSH withdrew, and what waited before the stream opened again', () => {
    expect(relayedPending(replay([snapshot, ready, ask, { stream: 'events', value: { type: 'cancel', eventId: 'e1' } }]))).toBeNull();
    expect(relayedPending(replay([snapshot, ready, ask, ready]))).toBeNull();
    expect(answerRelayed(replay([snapshot, ask]), 'e1#0', { kind: 'question', optionId: 'Yes' })).toBeNull();
  });
});
