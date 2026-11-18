/**
 * The `RelayClient` that reaches a member's computers through the relay
 * (docs/tech/relay.md, ADR 0009).
 *
 * - Where the relay is comes from the server the member signed in to:
 *   `GET <server>/api/relay` names its plugin socket, and the phone's socket
 *   (`/phone`) and HTTP endpoints share that origin.
 * - Computers are the member's confirmed pairings (`GET /pairings`), and a
 *   computer's id is its pairing's id, which every frame names. Admission also
 *   requires this handset's server/account-scoped relay credential, separate
 *   from the local E2EE identity and peer pins.
 * - One WebSocket carries everything, opened on first use with the member's
 *   token in its first frame. A unary DSH call is a `call` answered by a
 *   `result`; a stream (`session/follow`, `$events`) is `mux` frames.
 * - What the agent waits on arrives as a `$events` waterfall, one stream per
 *   computer, and is answered with `$events/result`.
 *
 * What DSH sends is read in `dsh.ts`; this module only carries it.
 */

import { HostFrameSchema, PHONE_PATH, type PhoneEvent } from './protocol';
import { webAesKey } from './aes-gcm';
import { SecureChannel, securePacket, newChannelId, type AesKey, type RandomBytes } from './secure-channel';
import { z } from 'zod';
import { UploadLimitsSchema } from './uploads';
import { configurationOf, ModelSelectionSchema, startableDirectories } from './session-config';

import {
  approvalResult,
  eventsOf,
  historyOf,
  directoryName,
  latestDirectoryOf,
  newStreams,
  pendingOf,
  questionsResult,
  sessionsOf,
  snapshotOf,
  streamEventsOf,
  waitingOf,
  type Streams,
  type Waiting,
} from './dsh';
import { applySessionEvent } from './session';
import { RelayError, type DeviceKeys, type Answer, type Computer, type Pending, type RelayClient, type RelayErrorCode, type SessionEvent, type SessionState } from './types';

export interface LiveRelayOptions {
  keys: DeviceKeys;
  random: RandomBytes;
  /**
   * The signed-in member's server and token, or null when signed out. A page of the server's own site gives no token:
   * its session cookie goes with every request and with the socket's upgrade.
   */
  session: () => Promise<{ server: string; token?: string } | null>;
  /** The language a question or approval reason is shown in. */
  locale: () => string;
  /**
   * What this device is, said to a computer when it pairs or joins so the computer's list of devices can name it
   * (the plugin's src/phone-security.ts): the phone app on iOS or Android, or a web browser.
   */
  device: 'ios' | 'android' | 'web';
  request?: typeof fetch;
  WebSocket?: typeof globalThis.WebSocket;
  /** The AES-256-GCM backend records are sealed with: WebCrypto unless the platform has a native one. */
  importAesKey?: (bytes: Uint8Array) => Promise<AesKey>;
}

/** How long a follow that lost its computer waits before it tries again, doubling to the last. */
export const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** Why a follow may end and come back: the socket, the channel or the computer went away for now. */
const RETRIED: ReadonlySet<RelayErrorCode> = new Set(['unavailable', 'offline']);

/** How many messages one read of older history asks for, as many as DSH's own opening window. */
const HISTORY_PAGE = 50;

/** How long a call may wait for its result before the screen is told it failed. */
export const CALL_TIMEOUT_MS = 20_000;

const PairingSchema = z.object({ id: z.string(), hostId: z.string(), hostName: z.string(), status: z.enum(['pending', 'confirmed']), online: z.boolean().optional(), push: z.boolean().optional() });

/** The relay's refusals, in the words the screens already have. */
const PHONE_ERRORS: Record<string, RelayErrorCode> = { not_paired: 'not_found', offline: 'offline', rate_limited: 'unavailable' };

interface Follow {
  pairingId: string;
  sessionId: string;
  /** Its stream on the computer, or empty while it is (re)opening or waits to retry. */
  streamId: string;
  state: SessionState;
  streams: Streams;
  emit: (event: SessionEvent) => void;
}

interface Events {
  streamId: string;
  /** Resolves once DSH has said the stream is ready, after which it replays what already waits. */
  ready: Promise<void>;
  clientId?: string;
  waiting: Map<string, Waiting>;
  /** Answers so far to a batch of questions, by event id. */
  answered: Map<string, string[]>;
}

interface Connection {
  socket: WebSocket;
  send(frame: unknown): void;
}

export function createLiveRelay(options: LiveRelayOptions): RelayClient {
  const request = options.request ?? fetch;
  let counter = 0;
  const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

  let connection: Promise<Connection> | null = null;
  let activeSocket: WebSocket | null = null;
  let generation = 0;
  const calls = new Map<string, { pairingId: string; resolve(value: unknown): void; reject(error: RelayError): void; timer: ReturnType<typeof setTimeout> }>();
  const streams = new Map<string, { pairingId: string; receive(body: Record<string, unknown>): void }>();
  const follows = new Set<Follow>();
  const events = new Map<string, Events>();
  /** Lists watching a computer's sessions, by pairing id. */
  const listWatchers = new Map<string, Set<() => void>>();
  const sessionsChanged = (pairingId: string) => listWatchers.get(pairingId)?.forEach((onChange) => onChange());
  interface SecureLink {
    channel: SecureChannel; channelId: string; ready: Promise<void>; resolve(): void; reject(error: RelayError): void;
    remoteKey?: string; known?: string; userConfirmed: boolean; accepted: boolean;
    code?: string; failed: boolean; revoked?: () => void;
  }
  const channels = new Map<string, SecureLink>();
  const opening = new Map<string, Promise<SecureLink>>();
  const pairingDrafts = new Map<string, import('./types').Pairing>();
  /** Each computer's PIN lock as it last said, who watches it, and who waits for its next answer. */
  const pins = new Map<string, import('./types').PinState>();
  const pinWatchers = new Map<string, Set<(state: import('./types').PinState | undefined) => void>>();
  const pinWaiters = new Map<string, (state: import('./types').PinState) => void>();
  function pinSaid(id: string, state: import('./types').PinState | undefined) {
    if (state) pins.set(id, state); else pins.delete(id);
    pinWatchers.get(id)?.forEach((onChange) => onChange(state));
    if (state) { pinWaiters.get(id)?.(state); pinWaiters.delete(id); }
  }
  async function pinRequest(id: string, message: Record<string, unknown>) {
    const answered = new Promise<import('./types').PinState>((resolve, reject) => {
      const timer = setTimeout(() => { pinWaiters.delete(id); reject(new RelayError('unavailable')); }, 15000);
      pinWaiters.set(id, (state) => { clearTimeout(timer); resolve(state); });
    });
    await sendSecure(id, message);
    return answered;
  }
  async function secureLink(id: string, pairing?: { name: string; expectedKey?: string; join?: { invite: string; secret: string } }): Promise<SecureLink> {
    const active = channels.get(id);
    if (active && !active.failed) return active;
    if (opening.has(id)) return opening.get(id)!;
    const epoch = generation;
    const pending = (async () => {
      const known = await options.keys.peer(id);
      if (!known && !pairing) throw new RelayError('device_verification_required');
      const identity = await options.keys.identity();
      const { send } = await connect();
      if (epoch !== generation) throw new RelayError('unavailable');
      let resolve!: () => void, reject!: (error: RelayError) => void;
      const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      void ready.catch(() => {});
      // eslint-disable-next-line prefer-const -- the channel's callbacks read it, once assigned below.
      let link!: SecureLink;
      const channel = new SecureChannel({
        pairingId: id, channelId: newChannelId(options.random), initiator: true, identity,
        importAesKey: options.importAesKey ?? webAesKey, expectedKey: known ?? pairing?.expectedKey, random: options.random, send,
        ready: (key, code) => {
          link.remoteKey = key; link.code = code;
          const draft = pairingDrafts.get(id);
          if (draft) draft.safetyCode = code;
          // A shared DSH's invite stands in for the safety code: its key is pinned, so only that DSH reads the secret.
          if (pairing?.join) channel.send({ t: 'shareJoin', invite: pairing.join.invite, secret: pairing.join.secret, name: pairing.name, kind: options.device });
          else if (pairing) channel.send({ t: 'pairHello', name: pairing.name, kind: options.device });
        },
        message: async value => {
          const body = value as Record<string, unknown> | null;
          if (body?.t === 'verify' && !known) return;
          if (body?.t === 'joinRefused' && pairing?.join) { channel.close(new Error('invite_refused')); return; }
          if (body?.t === 'pairAccepted' && (link.userConfirmed || pairing?.join) && link.remoteKey) {
            await options.keys.trust(id, link.remoteKey);
            const draft = pairingDrafts.get(id);
            if (draft) draft.status = 'confirmed';
            link.accepted = true; channel.verified(); resolve(); return;
          }
          if (body?.t === 'secureReady' && known) {
            link.accepted = true; channel.verified(); resolve(); return;
          }
          if (body?.t === 'revokedAck' && link.accepted) { link.revoked?.(); return; }
          if (!link.accepted) throw new Error('device_not_verified');
          // The computer's PIN lock, said in the channel; nothing else of the member's work passes while it is shut.
          if (body?.t === 'pinRequired') return pinSaid(id, { kind: 'required', set: body.set === true });
          if (body?.t === 'unlocked') return pinSaid(id, { kind: 'unlocked' });
          if (body?.t === 'pinWrong') return pinSaid(id, { kind: 'wrong', left: typeof body.left === 'number' ? body.left : 0 });
          if (body?.t === 'pinLocked') return pinSaid(id, { kind: 'locked' });
          if (body?.t === 'pinInvalid') return pinSaid(id, { kind: 'invalid' });
          const inner = HostFrameSchema.safeParse(value);
          if (!inner.success || inner.data.pairingId !== id) throw new Error('invalid_secure_message');
          receiveBusiness(inner.data);
        },
        closed: error => {
          if (channels.get(id) !== link) return;
          link.failed = true;
          const code = error.message === 'device_key_changed' || error.message === 'invite_refused' ? error.message : 'unavailable';
          reject(new RelayError(code));
          const draft = pairingDrafts.get(id);
          if (draft) draft.verificationError = true;
          endPairing(id, code);
        },
      });
      link = { channel, channelId: '', ready, resolve, reject, known, userConfirmed: false, accepted: false, failed: false };
      link.channelId = channel.id;
      channels.set(id, link); channel.start(); return link;
    })();
    opening.set(id, pending);
    try { return await pending; }
    finally { if (opening.get(id) === pending) opening.delete(id); }
  }
  async function sendSecure(id: string, value: unknown) {
    const link = await secureLink(id);
    await link.ready;
    if (link.failed || channels.get(id) !== link) throw new RelayError('unavailable');
    try { link.channel.send(value); }
    catch { link.channel.close(); throw new RelayError('unavailable'); }
  }


  async function signedIn() {
    const session = await options.session();
    if (!session) throw new RelayError('unavailable');
    return session;
  }

  /** The relay's HTTP origin, from the plugin socket the server names. */
  async function relayOrigin(server: string) {
    const response = await request(`${server}/api/relay`);
    if (!response.ok) throw new RelayError('unavailable');
    const { url } = z.object({ url: z.string() }).parse(await response.json());
    return url.replace(/^ws/, 'http').replace(/\/plugin$/, '');
  }

  async function relayHttp(path: string, init: RequestInit = {}) {
    const { server, token } = await signedIn();
    const response = await request(`${await relayOrigin(server)}${path}`, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-device-key': await options.keys.relayKey({ server, token }), 'content-type': 'application/json', ...init.headers },
    });
    return response;
  }

  function connect(): Promise<Connection> {
    const epoch = generation;
    connection ??= (async () => {
      const { server, token } = await signedIn();
      const deviceKey = await options.keys.relayKey({ server, token });
      const origin = await relayOrigin(server);
      if (epoch !== generation) throw new RelayError('unavailable');
      const Socket = options.WebSocket ?? globalThis.WebSocket;
      const socket = new Socket(origin.replace(/^http/, 'ws') + PHONE_PATH);
      activeSocket = socket;
      const send = (frame: unknown) => socket.send(JSON.stringify(frame));
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => send({ t: 'hello', ...(token ? { token } : {}), deviceKey });
        socket.onerror = () => reject(new RelayError('unavailable'));
        socket.onclose = () => {
          reject(new RelayError('unavailable'));
          if (epoch === generation) lost();
        };
        socket.onmessage = (message) => {
          if (epoch !== generation) return;
          const frame = parse(String(message.data));
          if (frame?.t === 'welcome') resolve();
          else receive(frame);
        };
      });
      return { socket, send };
    })();
    connection.catch(() => {
      if (epoch === generation) connection = null;
    });
    return connection;
  }

  /**
   * Follows that lost their computer for now try again, all together, after a wait that doubles while they keep
   * failing. Each says it is closed meanwhile; its fresh snapshot, once it opens again, clears that.
   */
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  function retryLater() {
    if (retryTimer || ![...follows].some((follow) => !follow.streamId)) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retries++;
      for (const follow of follows) if (!follow.streamId) void open(follow);
    }, RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]);
  }
  /** A follow's stream ended: for good unless `reason` is one that passes. */
  function interrupted(follow: Follow, reason: RelayErrorCode) {
    if (follow.streamId) streams.delete(follow.streamId);
    follow.streamId = '';
    follow.emit({ type: 'closed', reason });
    if (RETRIED.has(reason)) return retryLater();
    follows.delete(follow);
  }

  /** The socket closed: every call fails, every stream ends, and the next use reconnects; follows retry. */
  function lost() {
    connection = null;
    for (const link of channels.values()) link.channel.close();
    channels.clear(); opening.clear();
    for (const [id, call] of calls) {
      clearTimeout(call.timer);
      call.reject(new RelayError('unavailable'));
      calls.delete(id);
    }
    streams.clear();
    events.clear();
    for (const follow of [...follows]) interrupted(follow, 'unavailable');
  }

  function receive(frame: Record<string, unknown> | null) {
    if (!frame) return;
    if (securePacket(frame)) {
      const link = channels.get(frame.pairingId);
      if (link && link.channelId === frame.channelId) link.channel.receive(frame);
      return;
    }
    const event = frame as PhoneEvent;
    if (event.t === 'error') {
      const code = PHONE_ERRORS[event.error] ?? 'unavailable';
      if (event.id) return fail(event.id, code);
      endPairing(event.pairingId, code);
      // A packet refused because the desktop is gone: a handshake waiting on it
      // fails now, with the reason, instead of at its own timeout.
      if (event.error !== 'rate_limited') dropLink(event.pairingId, code);
      return;
    }
    if (event.t === 'revoked' || event.t === 'detached' || event.t === 'offline') {
      const code = event.t === 'offline' ? 'offline' : 'not_found';
      endPairing(event.pairingId, code);
      dropLink(event.pairingId, code);
      return;
    }
  }

  /** Ends a computer's encrypted link, failing whatever waits on its handshake with `code`. */
  function dropLink(pairingId: string, code: RelayErrorCode) {
    const link = channels.get(pairingId);
    if (!link) return;
    link.reject(new RelayError(code));
    link.channel.close();
  }

  function receiveBusiness(data: z.infer<typeof HostFrameSchema>) {
    if (data.t === 'result') return settle(data.pairingId, data.id, data.status, data.body);
    const body = data.body as Record<string, unknown> | undefined;
    if (body && typeof body.streamId === 'string') {
      const stream = streams.get(body.streamId);
      if (stream?.pairingId === data.pairingId) stream.receive(body);
    }
  }

  function settle(pairingId: string, id: string, status: number, body: unknown) {
    const call = calls.get(id);
    if (!call || call.pairingId !== pairingId) return;
    calls.delete(id);
    clearTimeout(call.timer);
    const wire = body as { error?: string; result?: { ok?: boolean; value?: unknown; error?: { code?: string } } } | null;
    const result = wire?.result;
    if (status === 200 && result?.ok) call.resolve(result.value);
    else {
      const code = result?.error?.code ?? wire?.error ?? '';
      const known: Record<string, RelayErrorCode> = {
        'method_not_allowed': 'configuration_unsupported', configuration_unsupported: 'configuration_unsupported',
        'no_web_server': 'offline', dsh_unreachable: 'offline',
        'session/not-found': 'not_found', 'session/agent-busy': 'busy',
        'session/model-unavailable': 'model_unavailable', 'session/provider-credentials-unavailable': 'model_unavailable',
        'session/provider-models-unavailable': 'model_unavailable', 'agent-preset/not-found': 'preset_unavailable',
        'agent-preset/invalid': 'preset_unavailable', 'agent-preset/locked': 'busy',
        'teamwork/busy': 'busy', 'teamwork/not_found': 'not_found', 'teamwork/not_authenticated': 'not_authenticated',
        'teamwork/missing_tools': 'missing_tools', 'teamwork/missing_plugins': 'missing_plugins',
        'teamwork/file_type': 'file_type', 'teamwork/file_name': 'file_name', 'teamwork/file_too_large': 'file_too_large', 'teamwork/invalid_upload': 'invalid_upload',
        'teamwork/upload_expired': 'upload_expired', 'teamwork/upload_failed': 'upload_failed', 'session/attachment-invalid': 'upload_expired',
        'teamwork/locked': 'locked', 'teamwork/preset_changed': 'preset_changed', 'teamwork/model_unavailable': 'model_unavailable', 'teamwork/invalid_request': 'invalid_request',
      };
      call.reject(new RelayError(known[code] ?? 'unavailable'));
    }
  }

  function fail(id: string, code: RelayErrorCode) {
    const call = calls.get(id);
    if (!call) return;
    calls.delete(id);
    clearTimeout(call.timer);
    call.reject(new RelayError(code));
  }

  function endPairing(pairingId: string, reason: RelayErrorCode) {
    // A new channel starts locked again: the computer unlocks one channel at a time.
    if (pins.has(pairingId)) pinSaid(pairingId, undefined);
    const ended = events.get(pairingId);
    if (ended) streams.delete(ended.streamId);
    events.delete(pairingId);
    for (const follow of [...follows]) if (follow.pairingId === pairingId && follow.streamId) interrupted(follow, reason);
  }

  /** Opens a follow's stream: its snapshot, then every change. A failure ends it, or retries it (`interrupted`). */
  async function open(follow: Follow) {
    const { pairingId: computerId, sessionId } = follow;
    follow.streamId = 'opening';
    try {
      await watchEvents(computerId);
      if (!follows.has(follow)) return;
      const streamId = await openStream(computerId, 'session/follow', { request: { address: { kind: 'session', sessionId }, activate: true, assistantStream: true } }, (body) => {
        // Frames can come before `openStream` returns, while the follow still says it is opening.
        if (follow.streamId !== streamId && follow.streamId !== 'opening') return;
        if (body.type === 'error') {
          const code = (body.error as { code?: unknown } | undefined)?.code;
          // DSH or its web server went away, and may come back; anything else is this session's own end.
          return interrupted(follow, code === 'dsh_closed' || code === 'dsh_unreachable' || code === 'no_web_server' ? 'unavailable' : 'not_found');
        }
        if (body.type !== 'item') return;
        const value = body.value as Record<string, unknown> | undefined;
        if (value?.type === 'snapshot') {
          retries = 0;
          follow.state = { ...snapshotOf(value), pending: pendingFor(computerId, sessionId) };
          return follow.emit({ type: 'snapshot', state: follow.state });
        }
        const changes =
          value?.type === 'event'
            ? eventsOf(value.event, follow.state)
            : value?.type === 'assistant-stream'
              ? streamEventsOf(value.frame, follow.streams, follow.state)
              : [];
        for (const change of changes) {
          follow.state = applySessionEvent(follow.state, change);
          follow.emit(change);
        }
      });
      if (follows.has(follow) && follow.streamId === 'opening') follow.streamId = streamId;
      else {
        // Stopped, or interrupted, while it opened.
        streams.delete(streamId);
        void sendSecure(computerId, { t: 'mux', pairingId: computerId, body: { type: 'cancel', streamId } }).catch(() => {});
      }
    } catch (error) {
      if (!follows.has(follow) || follow.streamId !== 'opening') return;
      follow.streamId = '';
      interrupted(follow, error instanceof RelayError ? error.code : 'unavailable');
    }
  }

  async function call(pairingId: string, method: string, args: unknown): Promise<unknown> {
    const link = await secureLink(pairingId);
    await link.ready;
    const id = nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(id, 'unavailable'), CALL_TIMEOUT_MS);
      calls.set(id, { pairingId, resolve, reject, timer });
      void sendSecure(pairingId, { t: 'call', pairingId, id, method, body: { args } }).catch(() => fail(id, 'unavailable'));
    });
  }

  async function openStream(pairingId: string, endpoint: string, args: unknown, onBody: (body: Record<string, unknown>) => void) {
    const link = await secureLink(pairingId);
    await link.ready;
    const streamId = nextId();
    streams.set(streamId, { pairingId, receive: onBody });
    await sendSecure(pairingId, { t: 'mux', pairingId, body: { type: 'open', streamId, endpoint, payload: { args } } });
    return streamId;
  }

  /** What a session's follower should show as waiting: the oldest request for it, or nothing. */
  function pendingFor(pairingId: string, sessionId: string) {
    const known = events.get(pairingId);
    for (const waiting of known?.waiting.values() ?? []) {
      if (waiting.agentId === sessionId) return pendingOf(waiting, known!.answered.get(waiting.eventId)?.length ?? 0);
    }
    return null;
  }

  function tellFollowers(pairingId: string, sessionId: string, event: SessionEvent) {
    for (const follow of follows) {
      if (follow.pairingId !== pairingId || follow.sessionId !== sessionId) continue;
      follow.state = applySessionEvent(follow.state, event);
      follow.emit(event);
    }
  }

  /** One `$events` stream per computer, opened by its first follower and kept while the socket lives. */
  async function watchEvents(pairingId: string) {
    if (events.has(pairingId)) return;
    let isReady = () => {};
    const watched: Events = { streamId: '', ready: new Promise((resolve) => (isReady = resolve)), waiting: new Map(), answered: new Map() };
    events.set(pairingId, watched);
    // A stream that never opened is not kept: the next follow or list opens one again.
    const opened = openStream(pairingId, '$events', {}, (body) => {
      if (body.type !== 'item') return;
      const value = body.value as Record<string, unknown> | undefined;
      if (!value) return;
      if (value.type === 'ready' && typeof value.clientId === 'string') {
        watched.clientId = value.clientId;
        isReady();
      } else if (value.type === 'emit' && value.event === 'api-session/status' && Array.isArray(value.args)) {
        const [sessionId, running] = value.args as [unknown, unknown];
        if (typeof sessionId === 'string') tellFollowers(pairingId, sessionId, { type: 'status', status: running === true ? 'running' : 'idle' });
        sessionsChanged(pairingId);
      } else if (value.type === 'waterfall') {
        const waiting = waitingOf(value, options.locale());
        if (!waiting) return;
        watched.waiting.set(waiting.eventId, waiting);
        tellFollowers(pairingId, waiting.agentId, { type: 'pending', pending: pendingFor(pairingId, waiting.agentId) });
        sessionsChanged(pairingId);
      } else if (value.type === 'cancel' && typeof value.eventId === 'string') {
        const waiting = watched.waiting.get(value.eventId);
        if (!waiting) return;
        watched.waiting.delete(value.eventId);
        watched.answered.delete(value.eventId);
        tellFollowers(pairingId, waiting.agentId, { type: 'pending', pending: pendingFor(pairingId, waiting.agentId) });
        sessionsChanged(pairingId);
      }
    });
    try {
      watched.streamId = await opened;
    } catch (error) {
      if (events.get(pairingId) === watched) events.delete(pairingId);
      throw error;
    }
  }

  return {
    reset() {
      generation++;
      const socket = activeSocket;
      activeSocket = null;
      // Signed out: nothing comes back.
      clearTimeout(retryTimer);
      retryTimer = undefined;
      retries = 0;
      for (const follow of [...follows]) interrupted(follow, 'not_found');
      lost();
      listWatchers.clear();
      socket?.close();
    },
    async listComputers(): Promise<Computer[]> {
      const response = await relayHttp('/pairings');
      if (!response.ok) throw new RelayError('unavailable');
      const { pairings } = z.object({ pairings: PairingSchema.array() }).parse(await response.json());
      return Promise.all(pairings.filter((p) => p.status === 'confirmed').map(async (p) => ({ id: p.id, name: p.hostName, online: p.online === true, verified: !!await options.keys.peer(p.id), push: p.push === true, hostId: p.hostId })));
    },

    async sharedHosts() {
      const response = await relayHttp('/shared');
      if (!response.ok) throw new RelayError('unavailable');
      return z.object({
        hosts: z.object({ id: z.string(), name: z.string(), teamId: z.string(), teamName: z.string(), online: z.boolean() }).array(),
        unavailableTeamIds: z.string().array(),
      }).parse(await response.json());
    },

    async pair(code, deviceName, expectedKey) {
      const response = await relayHttp('/pair', {
        method: 'POST',
        body: JSON.stringify({ code, deviceName }),
      });
      if (response.status === 400) throw new RelayError('not_found');
      if (!response.ok) throw new RelayError('unavailable');
      const pairing = z.object({ pairing: PairingSchema }).parse(await response.json()).pairing;
      const draft: import('./types').Pairing = { ...pairing, status: 'pending' };
      pairingDrafts.set(pairing.id, draft);
      await secureLink(pairing.id, { name: deviceName, expectedKey });
      return draft;
    },

    async join(invite, deviceName) {
      const response = await relayHttp(`/shared/${encodeURIComponent(invite.host)}/join`, { method: 'POST', body: JSON.stringify({ deviceName }) });
      if (response.status === 404 || response.status === 400) throw new RelayError('not_found');
      if (!response.ok) throw new RelayError('unavailable');
      const pairing = z.object({ pairing: PairingSchema }).parse(await response.json()).pairing;
      const draft: import('./types').Pairing = { ...pairing, status: 'pending' };
      pairingDrafts.set(pairing.id, draft);
      const link = await secureLink(pairing.id, { name: deviceName, expectedKey: invite.key, join: { invite: invite.invite, secret: invite.secret } });
      await link.ready;
      return { ...draft };
    },

    watchPin(computerId, onChange) {
      let watchers = pinWatchers.get(computerId);
      if (!watchers) pinWatchers.set(computerId, (watchers = new Set()));
      watchers.add(onChange);
      onChange(pins.get(computerId));
      return () => { watchers!.delete(onChange); };
    },
    unlock(computerId, pin) { return pinRequest(computerId, { t: 'unlock', pin }); },
    setPin(computerId, pin, old) { return pinRequest(computerId, { t: 'setPin', pin, ...(old ? { old } : {}) }); },

    async confirmPairing(id) {
      const link = channels.get(id);
      if (!link?.code || link.failed) throw new RelayError('device_verification_required');
      link.userConfirmed = true;
      link.channel.send({ t: 'pairConfirm' });
    },
    async getPairing(id) {
      const response = await relayHttp('/pairings');
      if (!response.ok) throw new RelayError('unavailable');
      const row = z.object({ pairings: PairingSchema.array() }).parse(await response.json()).pairings.find(pairing => pairing.id === id);
      if (!row) return null;
      return pairingDrafts.get(id) ? { ...pairingDrafts.get(id)! } : { ...row, status: await options.keys.peer(id) ? row.status : 'pending' };

    },

    async setPush(id, push) {
      const response = await relayHttp(`/pairings/${encodeURIComponent(id)}/push`, {
        method: 'PUT',
        body: JSON.stringify(push ?? { pushToken: null }),
      });
      if (response.status === 404) throw new RelayError('not_found');
      if (!response.ok) throw new RelayError('unavailable');
    },

    async revokeComputer(id) {
      // A connected desktop removes its trust and acknowledges over the encrypted channel first, so it holds
      // even if the relay lies about revocation. One the relay reports offline or unpaired is cut off by the
      // relay alone, and drops its trust when it next lists its pairings (docs/tech/relay.md).
      try {
        const link = await secureLink(id);
        await link.ready;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { link.revoked = undefined; reject(new RelayError('unavailable')); }, 10000);
          link.revoked = () => { clearTimeout(timer); resolve(); };
          try { link.channel.send({ t: 'revoke' }); } catch { clearTimeout(timer); link.revoked = undefined; reject(new RelayError('unavailable')); }
        });
      } catch (error) {
        const code = error instanceof RelayError ? error.code : 'unavailable';
        if (code !== 'offline' && code !== 'not_found') throw new RelayError(code);
      }
      await options.keys.forget(id);
      channels.get(id)?.channel.close();
      const response = await relayHttp(`/pairings/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new RelayError('unavailable');
      endPairing(id, 'not_found');
    },

    async listSessions(computerId) {
      // Knowing which sessions wait on the member needs the computer's $events: DSH replays what waits once it is ready.
      await watchEvents(computerId);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([events.get(computerId)?.ready, new Promise((resolve) => { timeout = setTimeout(resolve, 2_000); })]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      const pending = new Map<string, Pending>();
      for (const { agentId } of events.get(computerId)?.waiting.values() ?? []) {
        const next = pendingFor(computerId, agentId);
        if (next && !pending.has(agentId)) pending.set(agentId, next);
      }
      return sessionsOf(await call(computerId, 'session/list', { _request: {} }), pending);
    },

    watchSessions(computerId, onChange) {
      let watchers = listWatchers.get(computerId);
      if (!watchers) listWatchers.set(computerId, (watchers = new Set()));
      watchers.add(onChange);
      return () => void watchers.delete(onChange);
    },

    follow(computerId, sessionId, onEvent) {
      const follow: Follow = {
        pairingId: computerId,
        sessionId,
        streamId: '',
        state: { status: 'idle', items: [], pending: null, closed: null, earlier: null },
        streams: newStreams(),
        emit: onEvent,
      };
      follows.add(follow);
      void open(follow);
      return () => {
        follows.delete(follow);
        const streamId = follow.streamId;
        if (!streamId || streamId === 'opening') return;
        streams.delete(streamId);
        void sendSecure(computerId, { t: 'mux', pairingId: computerId, body: { type: 'cancel', streamId } }).catch(() => {});
      };
    },

    async older(computerId, sessionId) {
      const followed = [...follows].find((f) => f.pairingId === computerId && f.sessionId === sessionId);
      const before = followed?.state.earlier;
      if (before == null) return;
      const page = historyOf(await call(computerId, 'session/page', { request: { address: { kind: 'session', sessionId }, beforeSeq: before, maxMessages: HISTORY_PAGE } }));
      // Another read got there first: the items it read stay as they are.
      if (followed!.state.earlier !== before) return;
      tellFollowers(computerId, sessionId, { type: 'older', items: page.items, earlier: page.earlier });
    },

    async createSession(computerId, options = {}) {
      const sessions = await call(computerId, 'session/list', { _request: {} });
      const offered = ((await call(computerId, 'teamwork/configuration', { request: {} }).catch(() => null)) as { directories?: unknown } | null)?.directories;
      const directories = startableDirectories(sessions, Array.isArray(offered) ? offered.filter((path): path is string => typeof path === 'string') : []);
      const cwd = options.cwd ?? latestDirectoryOf(sessions) ?? directories[0]?.path;
      if (!cwd) throw new RelayError('no_directory');
      if (!directories.some(directory => directory.path === cwd)) throw new RelayError('invalid_directory');
      const created = (await call(computerId, 'session/create', { request: { cwd, ...(options.agentPreset ? { agentPreset: options.agentPreset } : {}) } })) as { sessionId?: unknown } | null;
      if (typeof created?.sessionId !== 'string') throw new RelayError('unavailable');
      return { id: created.sessionId, directory: directoryName(cwd) };
    },

    async configuration(computerId, sessionId) {
      const [sessions, models, configuration] = await Promise.all([
        call(computerId, 'session/list', { _request: {} }), call(computerId, 'session/modelCatalog', {}),
        call(computerId, 'teamwork/configuration', { request: { ...(sessionId ? { sessionId } : {}) } }),
      ]);
      return configurationOf(sessions, models, configuration);
    },

    async selectModel(computerId, sessionId, selection) {
      return z.object({ selected: ModelSelectionSchema }).parse(await call(computerId, 'teamwork/selectModel', { request: { sessionId, ...selection } })).selected;
    },

    async uploadCapabilities(computerId) {
      return (
        z
          .object({ uploads: UploadLimitsSchema.nullish() })
          .parse(await call(computerId, 'teamwork/configuration', { request: {} })).uploads ?? null
      );
    },
    async startUpload(computerId, sessionId, name, bytes) {
      return z
        .object({
          uploadId: z.string(),
          chunkBytes: z
            .number()
            .int()
            .positive()
            .max(256 * 1024),
        })
        .parse(await call(computerId, 'teamwork/uploadStart', { request: { sessionId, name, bytes } }));
    },
    async uploadChunk(computerId, sessionId, uploadId, offset, data) {
      return z
        .object({ received: z.number().int().nonnegative() })
        .parse(await call(computerId, 'teamwork/uploadChunk', { request: { sessionId, uploadId, offset, data } }))
        .received;
    },
    async finishUpload(computerId, sessionId, uploadId) {
      return z
        .object({
          receiptId: z.string(),
          file: z.object({ attachmentId: z.string(), name: z.string(), bytes: z.number().int().nonnegative() }),
        })
        .parse(await call(computerId, 'teamwork/uploadFinish', { request: { sessionId, uploadId } }));
    },
    async cancelUpload(computerId, sessionId, uploadId) {
      await call(computerId, 'teamwork/uploadCancel', { request: { sessionId, uploadId } });
    },
    async cancel(computerId, sessionId) {
      await call(computerId, 'session/cancel', { request: { sessionId } });
    },

    async prompt(computerId, sessionId, text, attachments) {
      await call(computerId, 'session/prompt', {
        request: {
          requestId: attachments?.requestId ?? nextId(),
          sessionId,
          mode: 'queue',
          content: [
            ...(text.trim() ? [{ type: 'text', text }] : []),
            ...(attachments?.receipts ?? []).map((receiptId) => ({ type: 'file', receiptId })),
          ],
        },
      });
    },

    async answer(computerId, sessionId, pendingId, answer: Answer) {
      const watched = events.get(computerId);
      const eventId = pendingId.split('#')[0]!;
      const waiting = watched?.waiting.get(eventId);
      if (!watched?.clientId || !waiting) throw new RelayError('stale');
      let value: unknown;
      if (waiting.kind === 'questions' && answer.kind === 'question') {
        const selected = [...(watched.answered.get(eventId) ?? []), answer.optionId];
        if (selected.length < waiting.questions.length) {
          watched.answered.set(eventId, selected);
          // The list shows the next question of the batch too.
          sessionsChanged(computerId);
          return tellFollowers(computerId, sessionId, { type: 'pending', pending: pendingFor(computerId, sessionId) });
        }
        value = questionsResult(waiting, selected);
      } else if (waiting.kind === 'approval' && answer.kind === 'approval') {
        value = approvalResult(answer.approve);
      } else {
        throw new RelayError('stale');
      }
      await call(computerId, '$events/result', { clientId: watched.clientId, eventId, outcome: { kind: 'result', value } });
      watched.waiting.delete(eventId);
      watched.answered.delete(eventId);
      sessionsChanged(computerId);
      tellFollowers(computerId, sessionId, { type: 'pending', pending: pendingFor(computerId, sessionId) });
    },
  };
}

function parse(text: string): Record<string, unknown> | null {
  if (text.length > 1024 * 1024) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
