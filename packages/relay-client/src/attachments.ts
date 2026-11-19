/**
 * A message's files, from choice to an acknowledged prompt, independent of how the bytes are read (docs/tech/relay.md,
 * "File attachments"): checked against the computer's limits, sent in acknowledged chunks through the plugin's four
 * upload calls, and submitted as receipts under one request id that survives an ambiguous acknowledgement. The phone
 * app and the web console each read the bytes their own way.
 */
import { RelayError, type RelayClient } from './types';
import type { SessionOptions } from './session-config';
import type { UploadedFile, UploadLimits } from './uploads';

export interface PickedFile {
  id: string;
  name: string;
  bytes: number;
  /** The reader's own handle for the bytes: a cache file's URI on the phone, a key into the page's own files in a browser. */
  uri: string;
}
export type SessionTarget = { id: string; directory: string };
export interface FileDraft {
  files: PickedFile[];
  target?: SessionTarget;
  creating?: Promise<SessionTarget>;
  options?: SessionOptions;
  uploaded: Map<string, UploadedFile & { sessionId: string }>;
  pending?: { fingerprint: string; requestId: string; sent: boolean };
}
export const newFileDraft = (): FileDraft => ({ files: [], uploaded: new Map() });
export function filesReady(draft: FileDraft, sessionId = draft.target?.id) {
  return draft.files.every((file) => {
    const uploaded = draft.uploaded.get(file.id);
    return !!uploaded && uploaded.sessionId === sessionId;
  });
}
export function validateFiles(files: PickedFile[], limits: UploadLimits) {
  if (files.some((file) => !file.name.length || file.name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(file.name)))
    throw new RelayError('file_name');
  if (
    files.length > limits.maxFiles ||
    files.some((f) => f.bytes < 0 || f.bytes > limits.maxFileBytes) ||
    files.reduce((n, f) => n + f.bytes, 0) > limits.maxMessageBytes
  )
    throw new RelayError('file_too_large');
  if (files.some((f) => !limits.extensions.includes(f.name.split('.').pop()!.toLowerCase())))
    throw new RelayError('file_type');
}
export function encodeChunk(data: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += 4096) parts.push(String.fromCharCode(...data.subarray(i, i + 4096)));
  return btoa(parts.join(''));
}
export function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new RelayError('upload_cancelled');
}

/** Coalesce provisional-session creation across drawer mounts; stale resolutions cannot retarget the draft. */
export async function ensureFileTarget(
  relay: Pick<RelayClient, 'createSession'>,
  computerId: string,
  draft: FileDraft,
  sessionId?: string,
): Promise<SessionTarget> {
  if (sessionId) return { id: sessionId, directory: '' };
  if (draft.target) return draft.target;
  if (draft.creating) return draft.creating;
  const creating = relay.createSession(computerId, draft.options ?? {});
  draft.creating = creating;
  try {
    const target = await creating;
    if (draft.creating === creating) draft.target = target;
    return target;
  } finally {
    if (draft.creating === creating) draft.creating = undefined;
  }
}

/** Transfer selected bytes without submitting any prompt. */
export async function uploadFiles(options: {
  relay: Pick<RelayClient, 'startUpload' | 'uploadChunk' | 'finishUpload' | 'cancelUpload'>;
  computerId: string;
  sessionId: string;
  draft: FileDraft;
  limits: UploadLimits | null;
  signal: AbortSignal;
  read: (file: PickedFile, offset: number, length: number) => Promise<Uint8Array>;
  progress: (name: string, sent: number, total: number) => void;
}) {
  const { relay, computerId, sessionId, draft, limits, signal, progress } = options;
  checkCancelled(signal);
  if (draft.files.length) {
    if (!limits) throw new RelayError('upload_unsupported');
    validateFiles(draft.files, limits);
  }
  const total = draft.files.reduce((sum, file) => sum + file.bytes, 0);
  let sent = 0;
  for (const file of draft.files) {
    checkCancelled(signal);
    const cached = draft.uploaded.get(file.id);
    if (cached?.sessionId === sessionId) {
      sent += file.bytes;
      progress(file.name, sent, total);
      continue;
    }
    const started = await relay.startUpload(computerId, sessionId, file.name, file.bytes);
    const abort = () => {
      void relay.cancelUpload(computerId, sessionId, started.uploadId).catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      let offset = 0;
      while (offset < file.bytes) {
        checkCancelled(signal);
        const data = await options.read(file, offset, Math.min(started.chunkBytes, file.bytes - offset));
        checkCancelled(signal);
        if (!data.length || data.length > started.chunkBytes || offset + data.length > file.bytes)
          throw new RelayError('invalid_upload');
        const received = await relay.uploadChunk(computerId, sessionId, started.uploadId, offset, encodeChunk(data));
        if (received !== offset + data.length) throw new RelayError('invalid_upload');
        offset = received;
        progress(file.name, sent + offset, total);
      }
      checkCancelled(signal);
      const receipt = await relay.finishUpload(computerId, sessionId, started.uploadId);
      checkCancelled(signal);
      draft.uploaded.set(file.id, { ...receipt, uploadId: started.uploadId, sessionId });
      sent += file.bytes;
      progress(file.name, sent, total);
    } catch (error) {
      void relay.cancelUpload(computerId, sessionId, started.uploadId).catch(() => {});
      if (signal.aborted) throw new RelayError('upload_cancelled');
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}

/** One immutable outgoing message keeps its id after a lost acknowledgement. */
export async function deliverFiles(options: {
  relay: Pick<RelayClient, 'startUpload' | 'uploadChunk' | 'finishUpload' | 'cancelUpload' | 'prompt'>;
  computerId: string;
  sessionId: string;
  text: string;
  draft: FileDraft;
  signal: AbortSignal;
  requestId: () => string;
  submitted?: () => void;
}) {
  const { relay, computerId, sessionId, text, draft, signal } = options;
  if (!draft.pending?.sent && !filesReady(draft, sessionId)) throw new RelayError('upload_expired');
  const fingerprint = JSON.stringify([sessionId, text, draft.files.map((f) => f.id)]);
  if (draft.pending?.sent && draft.pending.fingerprint !== fingerprint) throw new RelayError('send_uncertain');
  if (draft.pending?.fingerprint !== fingerprint)
    draft.pending = { fingerprint, requestId: options.requestId(), sent: false };
  checkCancelled(signal);
  const pending = draft.pending;
  pending.sent = true;
  options.submitted?.();
  try {
    await relay.prompt(computerId, sessionId, text, {
      requestId: pending.requestId,
      receipts: draft.files.map((file) => draft.uploaded.get(file.id)!.receiptId),
    });
    draft.pending = undefined;
    draft.uploaded.clear();
  } catch (error) {
    const code = error instanceof RelayError ? error.code : 'unavailable';
    if (!['unavailable', 'offline'].includes(code)) pending.sent = false;
    if (code === 'upload_expired') draft.uploaded.clear();
    throw error;
  }
}

/** Compact byte counts shared by draft and history cards. */
export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`;
}
