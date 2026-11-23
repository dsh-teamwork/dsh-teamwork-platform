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
import { bridgeValue, createDshSessions } from './dsh-sessions';
import { HOST_OS, RelayError, type DeviceKeys, type Computer, type OwnComputer, type RelayClient, type RelayErrorCode } from './types';

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

/** How long a call may wait for its result before the screen is told it failed. */
export const CALL_TIMEOUT_MS = 20_000;

const PairingSchema = z.object({ id: z.string(), hostId: z.string(), hostName: z.string(), hostOs: z.enum(HOST_OS).nullable().catch(null), hostLastSeenAt: z.string().nullable().catch(null), status: z.enum(['pending', 'confirmed']), online: z.boolean().optional(), push: z.boolean().optional() });

const OwnHostSchema = z.object({
  webOnline: z.boolean().optional(),
  id: z.string(), name: z.string(), dshVersion: z.string(), pluginVersion: z.string().nullable().catch(null),
  os: z.enum(HOST_OS).nullable().catch(null), online: z.boolean(), lastSeenAt: z.string(),
  pairings: z.object({ status: z.enum(['pending', 'confirmed']), current: z.boolean() }).array(),
});

/** The relay's refusals, in the words the screens already have. */
const PHONE_ERRORS: Record<string, RelayErrorCode> = { not_paired: 'not_found', offline: 'offline', rate_limited: 'unavailable' };

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
  const sessions = createDshSessions(
    {
      call,
      open: openStream,
      close(pairingId, streamId, cancel) {
        streams.delete(streamId);
        if (cancel) void sendSecure(pairingId, { t: 'mux', pairingId, body: { type: 'cancel', streamId } }).catch(() => {});
      },
    },
    { locale: options.locale, nextId },
  );
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

  /** What the server says of its relay: where the plugin socket is, and whether it delivers notifications. */
  async function discover(server: string) {
    const response = await request(`${server}/api/relay`);
    if (!response.ok) throw new RelayError('unavailable');
    return z.object({ url: z.string(), push: z.boolean() }).parse(await response.json());
  }

  /** The relay's HTTP origin, from the plugin socket the server names. */
  async function relayOrigin(server: string) {
    const { url } = await discover(server);
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
    sessions.endedAll();
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
    try {
      call.resolve(bridgeValue(status, body));
    } catch (error) {
      call.reject(error as RelayError);
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
    sessions.ended(pairingId, reason);
  }


  async function call(pairingId: string, method: string, args: unknown): Promise<unknown> {
    const link = await secureLink(pairingId);
    await link.ready;
    const id = nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(id, 'unavailable'), method === 'teamwork/readDocument' ? 75_000 : CALL_TIMEOUT_MS);
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

  return {
    reset() {
      generation++;
      const socket = activeSocket;
      activeSocket = null;
      // Signed out: nothing comes back.
      sessions.reset();
      lost();
      socket?.close();
    },
    async listComputers(): Promise<Computer[]> {
      const response = await relayHttp('/pairings');
      if (!response.ok) throw new RelayError('unavailable');
      const { pairings } = z.object({ pairings: PairingSchema.array() }).parse(await response.json());
      return Promise.all(pairings.filter((p) => p.status === 'confirmed').map(async (p) => ({ id: p.id, name: p.hostName, os: p.hostOs, lastSeenAt: p.hostLastSeenAt, online: p.online === true, verified: !!await options.keys.peer(p.id), push: p.push === true, hostId: p.hostId })));
    },

    async listHosts(): Promise<OwnComputer[]> {
      const response = await relayHttp('/hosts');
      // A server from before the app could list computers refuses its Bearer.
      if (response.status === 403) return [];
      if (!response.ok) throw new RelayError('unavailable');
      const { hosts } = z.object({ hosts: OwnHostSchema.array() }).parse(await response.json());
      return hosts.map((h) => ({
        hostId: h.id, name: h.name, os: h.os, online: h.online, lastSeenAt: h.lastSeenAt, dshVersion: h.dshVersion,
        ...(h.webOnline ? { webOnline: true } : {}), pluginVersion: h.pluginVersion, paired: h.pairings.some((p) => p.current && p.status === 'confirmed'),
      }));
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

    async offersPush() {
      return (await discover((await signedIn()).server)).push;
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

    listTasks: sessions.listTasks,
    watchTasks: sessions.watchTasks,
    createTask: sessions.createTask,
    updateTask: sessions.updateTask,
    deleteTask: sessions.deleteTask,
    runTask: sessions.runTask,
    taskHistory: sessions.taskHistory,
    listSessions: sessions.listSessions,
    watchSessions: sessions.watchSessions,
    follow: sessions.follow,
    older: sessions.older,
    createSession: sessions.createSession,
    configuration: sessions.configuration,
    selectModel: sessions.selectModel,
    selectPermission: sessions.selectPermission,
    listFiles: sessions.listFiles,
    searchFiles: sessions.searchFiles,
    readFile: sessions.readFile,
    readDocument: sessions.readDocument,
    uploadCapabilities: sessions.uploadCapabilities,
    startUpload: sessions.startUpload,
    uploadChunk: sessions.uploadChunk,
    finishUpload: sessions.finishUpload,
    cancelUpload: sessions.cancelUpload,
    cancel: sessions.cancel,
    renameSession: sessions.renameSession,
    pinSession: sessions.pinSession,
    archiveSession: sessions.archiveSession,
    prompt: sessions.prompt,
    answer: sessions.answer,
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
