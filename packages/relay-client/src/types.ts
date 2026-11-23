/**
 * What a client (the phone app, the web console) needs from a member's computers. Screens are written against
 * `RelayClient`; its implementation (`live.ts`) carries the frames in docs/tech/relay.md ("Frames") and reads DSH's
 * Remote API into these shapes (`dsh.ts`). They are the clients', not the wire's.
 */
import type { AutomationTask, Reminder, TaskHistory, TaskInput, TaskPatch } from './schedule';
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

/** A member's computer's operating system, as its plugin reports it to the relay. */
export const HOST_OS = ['macos', 'windows', 'linux'] as const;
export type HostOs = (typeof HOST_OS)[number];

/** How a client names an operating system: a product name, the same in every language. */
export const HOST_OS_NAMES: Record<HostOs, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

export interface Computer {
  /** The pairing's id: every frame for this computer names it. */
  id: string;
  /** The machine's name, as its DSH reported it. */
  name: string;
  /** Its operating system; null for a team's shared DSH, or a plugin too old to report one. */
  os: HostOs | null;
  /** Whether its DSH holds a connection to the relay right now. */
  online: boolean;
  /** When its DSH last connected to the relay (ISO), to say how long it has been away; null when never known. */
  lastSeenAt: string | null;
  /** A locally pinned desktop identity exists; routing status alone does not grant trust. */
  verified?: boolean;
  /** Whether the relay notifies this phone when the agent on it waits; the token itself never comes back. */
  push: boolean;
  /** The relay host the pairing reaches: for a team's shared DSH, its shared host's id. */
  hostId: string;
}

/**
 * One of the member's own computers (`GET /relay/hosts`), paired with this device or not: what a switcher offers to
 * pair. A team's shared DSH is never one.
 */
export interface OwnComputer {
  webOnline?: boolean;
  /** The relay host's id. */
  hostId: string;
  name: string;
  os: HostOs | null;
  online: boolean;
  /** When its DSH last connected to the relay (ISO). */
  lastSeenAt: string;
  dshVersion: string;
  /** The Teamwork plugin's version; null from a plugin too old to report it. */
  pluginVersion: string | null;
  /** Whether this device holds a confirmed pairing to it. */
  paired: boolean;
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

/** The DSH workspace that lists a session: its id and title, its place among the workspaces and the session's among its sessions, both DSH's own order. */
export interface SessionWorkspace {
  id: string;
  title: string;
  index: number;
  position: number;
}

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
  /**
   * Where DSH's sidebar lists it (the plugin's `teamwork` mark on `session/list`): pinned, archived, and the workspace
   * that lists it, or null under Ungrouped. Null from a plugin too old to mark its list, which cannot rename, pin or
   * archive either.
   */
  marks: { pinned: boolean; archived: boolean; workspace: SessionWorkspace | null } | null;
}

/** A folder of a session's working directory (the plugin's `src/phone-files.ts`); paths are relative, with `/`. */
export interface FolderListing {
  path: string;
  entries: { name: string; kind: 'file' | 'directory'; bytes?: number }[];
  truncated: boolean;
}

/** A text file of a session's working directory, cut at 256 KiB (`truncated`); `bytes` is its whole size. */
export interface FileText {
  path: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

export type ToolStatus = 'running' | 'done' | 'failed' | 'denied' | 'stopped';

export interface FileTarget { path: string; line?: number }

export interface ToolDetail {
  output: string;
  truncated: boolean;
  exitCode?: number;
}

export interface ToolResult {
  output: string;
  outputLength: number;
  tail?: string;
  isError: boolean;
  code?: string;
  reason?: string;
  reasonClipped?: true;
  file?: FileTarget;
  page?: PublishedPage;
}

export type ConversationItem =
  /** The member's turn; one an automation task delivered carries its `reminders`, and `text` is their instructions. */
  | { kind: 'user'; id: string; text: string; attachments?: { attachmentId: string; name: string; bytes: number }[]; reminders?: Reminder[] }
  | { kind: 'assistant'; id: string; text: string; reasoning?: string; turn?: number; streaming?: true; interrupted?: true }
  | { kind: 'deliverable'; id: string; turn: number; file: FileTarget; description?: string }
  | { kind: 'tool'; id: string; name: string; summary: string; status: ToolStatus; turn?: number; file?: FileTarget; background?: true; detail?: ToolDetail }
  /** A result whose call was outside the loaded history window. */
  | { kind: 'tool-result'; id: string; callId: string; result: ToolResult }
  | { kind: 'turn-end'; id: string; turn: number; completed: boolean }
  /** A page the agent published with `teamwork_page` (the platform's docs/tech/pages.md), after the tool that did. */
  | { kind: 'page'; id: string; page: PublishedPage }
  /**
   * A turn that ended in an error: DSH's own message, which the screen shows,
   * and `noModel` when the session had no model to call, which it explains.
   */
  | { kind: 'failed'; id: string; message: string; noModel: boolean };

/** What `teamwork_page` reports, in its result's `meta.teamworkPage`. */
export interface PublishedPage {
  teamId: string;
  pageId: string;
  version: number;
  title: string;
  kind: 'html' | 'markdown' | 'svg';
}

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
  | { type: 'delta'; id: string; text: string; reasoning?: true; turn?: number }
  | { type: 'discard-draft'; id: string }
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
  | 'permission_refused'
  | 'not_text'
  | 'file_type'
  | 'image_too_large'
  | 'image_model_unsupported'
  | 'camera_permission'
  | 'file_name'
  | 'file_too_large'
  | 'document_too_large'
  | 'document_empty'
  | 'preview_unavailable'
  | 'preview_unsupported'
  | 'invalid_upload'
  | 'upload_expired'
  | 'upload_failed'
  | 'upload_cancelled'
  | 'upload_unsupported'
  | 'send_uncertain'
  | 'device_verification_required'
  | 'device_key_changed'
  | 'invite_refused'
  | 'locked'
  /** Automation tasks: a shared DSH serves none; another device changed it since it was read; it already ended. */
  | 'schedule_unavailable'
  | 'schedule_conflict'
  | 'schedule_ended'
  /** DSH refused a task's input; `RelayError.detail` is DSH's own reason (`invalid_rule`, `not_future`, …). */
  | 'schedule_invalid'
  /** A task's session is archived, so nothing is delivered to it. */
  | 'target_archived';

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
  constructor(readonly code: RelayErrorCode, readonly detail?: string) {
    super(code);
    this.name = 'RelayError';
  }
}

export interface RelayClient {
  /** Ends this account's socket, calls and streams before another account can connect. */
  reset(): void;
  /** The member's paired computers: confirmed pairings only. */
  listComputers(): Promise<Computer[]>;
  /** The member's own computers, paired with this device or not; none from a server too old to list them to an app. */
  listHosts(): Promise<OwnComputer[]>;
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
  /** Whether the signed-in server delivers notifications at all; a self-hosted one never does. */
  offersPush(): Promise<boolean>;
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
  /** One folder of a session's working directory ("" is the directory itself), folders first; read only. */
  listFiles(computerId: string, sessionId: string, path: string): Promise<FolderListing>;
  /** Files under a session's working directory whose name holds `query`, nearest first. */
  searchFiles(computerId: string, sessionId: string, query: string): Promise<{ matches: string[]; truncated: boolean }>;
  /** A text file under a session's working directory: its first 256 KiB; a binary one is refused as `not_text`. */
  readFile(computerId: string, sessionId: string, path: string): Promise<FileText>;
  /**
   * A PDF or workbook under a session's working directory, or a Word or PowerPoint file as the PDF the computer's
   * Office Kit renders: its bytes, read in versioned 128 KiB ranges, at most 16 MiB. A plugin from before previews is
   * `preview_unsupported`; `signal` stops asking for further ranges.
   */
  readDocument(computerId: string, sessionId: string, path: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** Switches an idle session's permission preset (one of `configuration`'s `permissions`), and returns the one now in force. */
  selectPermission(computerId: string, sessionId: string, preset: string): Promise<string>;
  /** Stops the agent's current turn; what it already did stays. */
  cancel(computerId: string, sessionId: string): Promise<void>;
  /** Gives a session the title the member typed (DSH's `session/rename`), and returns it as DSH settled it. */
  renameSession(computerId: string, sessionId: string, title: string): Promise<string>;
  /** Pins a session ahead of the others, or unpins it, in DSH's sidebar as in every list. */
  pinSession(computerId: string, sessionId: string, pinned: boolean): Promise<void>;
  /** Archives a session, hidden from the lists until shown, or restores it; a running one is refused as `busy`. */
  archiveSession(computerId: string, sessionId: string, archived: boolean): Promise<void>;
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
  /** The computer's automation tasks, active first (the server's docs/tech/automation-tasks.md); `schedule_unavailable` on a shared DSH. */
  listTasks(computerId: string): Promise<AutomationTask[]>;
  /** Called whenever one of the computer's tasks changes, wherever it was changed, so a list can read itself again. Returns a function that stops the calls. */
  watchTasks(computerId: string, onChange: () => void): () => void;
  /** Saves a new task; `schedule_invalid` with DSH's reason when DSH refuses its input. */
  createTask(computerId: string, input: TaskInput): Promise<AutomationTask>;
  /** Changes, pauses (`active: false`) or resumes a task as it was read; `schedule_conflict` if it changed since. */
  updateTask(computerId: string, task: Pick<AutomationTask, 'id' | 'updatedAt'>, patch: TaskPatch): Promise<AutomationTask>;
  /** Deletes a task as it was read, with its saved deliveries; the sessions it delivered to stay. */
  deleteTask(computerId: string, task: Pick<AutomationTask, 'id' | 'updatedAt'>): Promise<void>;
  /** Delivers a task now, paused or not, without moving its next run; `busy` while a delivery of it is still pending. */
  runTask(computerId: string, taskId: string): Promise<AutomationTask>;
  /** One page of a task's deliveries, newest first; `before` is the previous page's cursor. */
  taskHistory(computerId: string, taskId: string, before?: string): Promise<TaskHistory>;
}
