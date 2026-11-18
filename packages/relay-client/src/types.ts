/**
 * What a client (the phone app, the web console) needs from a member's computers. Screens are written against
 * `RelayClient`; its implementation (`live.ts`) carries the frames in docs/tech/relay.md ("Frames") and reads DSH's
 * Remote API into these shapes (`dsh.ts`). They are the clients', not the wire's.
 */
import type { Identity } from './secure-channel';

/**
 * Where a client keeps its keys: its E2EE identity, the relay credential that admits this handset (separate from the
 * identity, and seen by the relay), and each computer's pinned key.
 */
export interface DeviceKeys {
  identity(): Promise<Identity>;
  relayKey(session: { server: string; token?: string }): Promise<string>;
  peer(id: string): Promise<string | undefined>;
  trust(id: string, key: string): Promise<void>;
  forget(id: string): Promise<void>;
}

export interface Computer {
  /** The pairing's id: every frame for this computer names it. */
  id: string;
  /** The machine's name, as its DSH reported it. */
  name: string;
  /** Whether its DSH holds a connection to the relay right now. */
  online: boolean;
  /** A locally pinned desktop identity exists; routing status alone does not grant trust. */
  verified?: boolean;
  /** Whether the relay notifies this phone when the agent on it waits; the token itself never comes back. */
  push: boolean;
  /** The relay host the pairing reaches: for a team's shared DSH, its shared host's id. */
  hostId: string;
}

/** A team's shared DSH the member may reach (`GET /relay/shared`). */
export interface SharedHost {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  online: boolean;
}

export interface Pairing {
  id: string;
  hostName: string;
  status: 'pending' | 'confirmed';
  safetyCode?: string;
  verificationError?: boolean;
}

export type SessionStatus = 'running' | 'idle';

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  /** ISO time of the last change. */
  updatedAt: string;
  /** The last part of the session's working directory: the project it works in. */
  directory: string;
  /** What the agent waits on the member for, a question or an approval, or null: the list answers it in place. */
  pending: Pending | null;
  /** A running turn's progress (the plugin's `teamworkStep`): its tool calls so far and what the latest works on; null when idle or not reported. */
  step: { count: number; tool: string; target: string } | null;
}

export type ToolStatus = 'running' | 'done' | 'failed' | 'denied';

export type ConversationItem =
  | { kind: 'user'; id: string; text: string; attachments?: { attachmentId: string; name: string; bytes: number }[] }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; status: ToolStatus };

/** Something the agent is waiting on the member for. At most one at a time. */
export type Pending =
  | { kind: 'question'; id: string; question: string; options: { id: string; label: string }[] }
  | { kind: 'approval'; id: string; title: string; detail: string };

export type Answer = { kind: 'question'; optionId: string } | { kind: 'approval'; approve: boolean };

/**
 * A session as a screen draws it. `Closed` is why a client's stream ended for good, in that client's own words: the
 * relay's codes here, another reason for a session the hosted edition reaches through its server.
 */
export interface SessionState<Closed = RelayErrorCode> {
  status: SessionStatus;
  items: ConversationItem[];
  pending: Pending | null;
  /** Set once the stream has ended for good; the screen says why. */
  closed: Closed | null;
  /** The event older history is read before (`RelayClient.older`), or null when the items begin at the session's start. */
  earlier: number | null;
}

/** What one frame changes in a session (`eventsOf`, `streamEventsOf` in `dsh.ts`), folded in by `applyChange`. */
export type SessionChange =
  /** An item added, or replaced when its id is already there. */
  | { type: 'item'; item: ConversationItem }
  /** Streamed text appended to an assistant item. */
  | { type: 'delta'; id: string; text: string }
  | { type: 'status'; status: SessionStatus };

/** What `follow` delivers, in order. `applySessionEvent` (session.ts) folds them into a `SessionState`. */
export type SessionEvent =
  /** The whole state, first on every follow. */
  | { type: 'snapshot'; state: SessionState }
  | SessionChange
  | { type: 'pending'; pending: Pending | null }
  /** Items from before the oldest shown, read by `RelayClient.older`. */
  | { type: 'older'; items: ConversationItem[]; earlier: number | null }
  | { type: 'closed'; reason: RelayErrorCode };

export type RelayErrorCode =
  | 'offline'
  | 'not_found'
  | 'busy'
  | 'stale'
  | 'unavailable'
  | 'no_directory'
  | 'invalid_directory'
  | 'configuration_unsupported'
  | 'model_unavailable'
  | 'not_authenticated'
  | 'missing_tools'
  | 'missing_plugins'
  | 'preset_changed'
  | 'preset_unavailable'
  | 'invalid_request'
  | 'file_type'
  | 'file_name'
  | 'file_too_large'
  | 'invalid_upload'
  | 'upload_expired'
  | 'upload_failed'
  | 'upload_cancelled'
  | 'upload_unsupported'
  | 'send_uncertain'
  | 'device_verification_required'
  | 'device_key_changed'
  | 'invite_refused'
  | 'locked';

/**
 * Where a computer's PIN lock stands (the server's `docs/tech/shared-dsh.md`, "The PIN"): open, asked for (or asked
 * to be set), refused with the tries left, or locked until cleared on that computer. Undefined until it says.
 */
export type PinState =
  | { kind: 'unlocked' }
  | { kind: 'required'; set: boolean }
  | { kind: 'wrong'; left: number }
  | { kind: 'locked' }
  | { kind: 'invalid' };

export class RelayError extends Error {
  constructor(readonly code: RelayErrorCode) {
    super(code);
    this.name = 'RelayError';
  }
}

export interface RelayClient {
  /** Ends this account's socket, calls and streams before another account can connect. */
  reset(): void;
  /** The member's paired computers: confirmed pairings only. */
  listComputers(): Promise<Computer[]>;
  /**
   * The teams' shared DSHs this member may reach, joined or not, and the member's teams the server has not enabled
   * Team DSH for, which reach none.
   */
  sharedHosts(): Promise<{ hosts: SharedHost[]; unavailableTeamIds: string[] }>;
  /**
   * Redeems the code a computer's Teamwork panel shows; the pairing then waits
   * for the member to confirm it on that computer. Rejects
   * `not_found` for a wrong, spent or expired code, or one shown on someone
   * else's computer.
   */
  pair(code: string, deviceName: string, expectedKey?: string): Promise<Pairing>;
  /**
   * Joins a team's shared DSH with an invite its admin handed over (`joinLink`): the handset pairs pending, pins the
   * DSH's key from the invite, and hands the invite over inside the encrypted channel. Resolves once the DSH accepted
   * it; rejects `not_found` when the member may not reach that DSH, and `invite_refused` when the DSH refused the invite.
   */
  join(invite: { host: string; key: string; invite: string; secret: string }, deviceName: string): Promise<Pairing>;
  confirmPairing(id: string): Promise<void>;
  /** A computer's PIN lock as it last said, and every change from now on; returns the unsubscribe. */
  watchPin(computerId: string, onChange: (state: PinState | undefined) => void): () => void;
  /** Gives the PIN; resolves with the computer's answer. */
  unlock(computerId: string, pin: string): Promise<PinState>;
  /** Sets a first PIN, or a new one with the old; resolves with the computer's answer. */
  setPin(computerId: string, pin: string, old?: string): Promise<PinState>;
  /** The exact pairing just submitted, including pending; null after refusal or revocation. */
  getPairing(id: string): Promise<Pairing | null>;
  /** Disconnects this phone from one computer, after the member confirms. */
  revokeComputer(id: string): Promise<void>;
  /**
   * Turns one computer's notifications on with this phone's token and
   * language, or off with null. Rejects `not_found` once the pairing is gone.
   */
  setPush(id: string, push: { pushToken: string; locale?: string } | null): Promise<void>;
  /** A computer's sessions, newest change first. Rejects `offline` when its DSH is not connected. */
  listSessions(computerId: string): Promise<SessionSummary[]>;
  /**
   * Creates with an exact known directory and native preset; an omitted folder
   * is the team's default workspace on the computer (`defaultDirectory`), and an
   * omitted preset the desktop default. Model changes are a separate
   * acknowledged session-only operation.
   */
  createSession(
    computerId: string,
    options?: Pick<import('./session-config').SessionOptions, 'cwd' | 'agentPreset' | 'teamId'>,
  ): Promise<{ id: string; directory: string }>;
  configuration(computerId: string, sessionId?: string): Promise<import('./session-config').SessionConfiguration>;
  selectModel(
    computerId: string,
    sessionId: string,
    selection: import('./session-config').ModelSelection,
  ): Promise<import('./session-config').ModelSelection>;
  uploadCapabilities(computerId: string): Promise<import('./uploads').UploadLimits | null>;
  startUpload(
    computerId: string,
    sessionId: string,
    name: string,
    bytes: number,
  ): Promise<{ uploadId: string; chunkBytes: number }>;
  uploadChunk(computerId: string, sessionId: string, uploadId: string, offset: number, data: string): Promise<number>;
  finishUpload(
    computerId: string,
    sessionId: string,
    uploadId: string,
  ): Promise<Omit<import('./uploads').UploadedFile, 'uploadId'>>;
  cancelUpload(computerId: string, sessionId: string, uploadId: string): Promise<void>;
  /** Stops the agent's current turn; what it already did stays. */
  cancel(computerId: string, sessionId: string): Promise<void>;
  /**
   * Called whenever a session of the computer starts or stops running, or
   * starts or stops waiting on the member, so a list can read itself again.
   * Returns a function that stops the calls.
   */
  watchSessions(computerId: string, onChange: () => void): () => void;
  /** Follows one session: a snapshot, then every change, a reply's text as it is written. Returns a function that stops following. */
  follow(computerId: string, sessionId: string, onEvent: (event: SessionEvent) => void): () => void;
  /**
   * Reads the history before a followed session's oldest item (its `earlier`), delivered to its followers as an
   * `older` event. Does nothing when the session is not followed or begins at its start.
   */
  older(computerId: string, sessionId: string): Promise<void>;
  /** Sends the member's message. Rejects `busy` while the agent is working or waiting. */
  prompt(
    computerId: string,
    sessionId: string,
    text: string,
    attachments?: { requestId: string; receipts: string[] },
  ): Promise<void>;
  /** Answers the pending question or approval `pendingId`. Rejects `stale` if it is no longer pending. */
  answer(computerId: string, sessionId: string, pendingId: string, answer: Answer): Promise<void>;
}
