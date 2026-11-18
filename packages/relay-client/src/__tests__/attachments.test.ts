import {
  deliverFiles,
  uploadFiles,
  ensureFileTarget,
  filesReady,
  encodeChunk,
  newFileDraft,
  validateFiles,
  type PickedFile,
} from '../attachments';
import { RelayError, type RelayClient } from '../types';
import type { UploadLimits } from '../uploads';
import { describe, expect, it, vi } from 'vitest';
const limits: UploadLimits = {
  maxFiles: 5,
  maxFileBytes: 20 * 1024 * 1024,
  maxMessageBytes: 50 * 1024 * 1024,
  chunkBytes: 3,
  extensions: ['txt', 'pdf'],
};
const file = (id: string) => ({ id, name: id + '.txt', bytes: 6, uri: id });
function setup() {
  const relay = {
    startUpload: vi.fn(async (_p, _s, name) => ({ uploadId: name, chunkBytes: 3 })),
    uploadChunk: vi.fn(async (_p, _s, _id, offset, data) => offset + atob(data).length),
    finishUpload: vi.fn(async (_p, _s, uploadId) => ({
      receiptId: uploadId,
      file: { attachmentId: 'hash', name: uploadId, bytes: 6 },
    })),
    cancelUpload: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
  };
  const draft = newFileDraft();
  draft.files = [file('one'), file('two')];
  const controller = new AbortController();
  const options = {
    relay: relay as unknown as RelayClient,
    computerId: 'p',
    sessionId: 's',
    text: '',
    draft,
    limits,
    signal: controller.signal,
    requestId: vi.fn(() => 'stable-id'),
    read: async (_file: PickedFile, offset: number, length: number) =>
      new TextEncoder().encode('abcdef').subarray(offset, offset + length),
    progress: vi.fn(),
  };
  return { relay, draft, controller, options };
}
it('validates declared file kinds, count and byte budgets, and encodes exact bounded bytes', () => {
  expect(() => validateFiles([{ ...file('one'), name: '../one.txt' }], limits)).toThrow(new RelayError('file_name'));
  expect(() => validateFiles([{ ...file('image'), name: 'image.png' }], limits)).toThrow(new RelayError('file_type'));
  expect(() => validateFiles(Array(6).fill(file('one')), limits)).toThrow(new RelayError('file_too_large'));
  expect(() => validateFiles([{ ...file('one'), bytes: limits.maxFileBytes + 1 }], limits)).toThrow();
  expect(Uint8Array.from(atob(encodeChunk(new Uint8Array([0, 255, 127, 128]))), (c) => c.charCodeAt(0))).toEqual(
    new Uint8Array([0, 255, 127, 128]),
  );
});
it('sends one file-only prompt after every receipt and retains original session binding', async () => {
  const { relay, options, draft } = setup();
  await uploadFiles(options);
  await deliverFiles(options);
  expect(relay.uploadChunk).toHaveBeenCalledTimes(4);
  expect(relay.prompt).toHaveBeenCalledWith('p', 's', '', { requestId: 'stable-id', receipts: ['one.txt', 'two.txt'] });
  expect(draft.uploaded.size).toBe(0);
  expect(draft.pending).toBeUndefined();
});
it('preserves successful receipts and the whole draft when another upload fails', async () => {
  const { relay, options, draft } = setup();
  relay.finishUpload
    .mockResolvedValueOnce({ receiptId: 'one.txt', file: { attachmentId: 'hash-one', name: 'one.txt', bytes: 6 } })
    .mockRejectedValueOnce(new RelayError('upload_failed'));
  await expect(uploadFiles(options)).rejects.toMatchObject({ code: 'upload_failed' });
  expect(relay.prompt).not.toHaveBeenCalled();
  expect(draft.files).toHaveLength(2);
  expect(draft.uploaded.has('one')).toBe(true);
  await uploadFiles(options);
  expect(relay.prompt).not.toHaveBeenCalled();
  await deliverFiles(options);
  expect(relay.startUpload.mock.calls.map((call) => call[2])).toEqual(['one.txt', 'two.txt', 'two.txt']);
});
it('retries an ambiguous submission with the same message id and no duplicate uploads', async () => {
  const { relay, options, draft } = setup();
  await uploadFiles(options);
  relay.prompt.mockRejectedValueOnce(new RelayError('unavailable'));
  await expect(deliverFiles(options)).rejects.toMatchObject({ code: 'unavailable' });
  expect(draft.pending?.sent).toBe(true);
  await expect(deliverFiles({ ...options, text: 'edited' })).rejects.toMatchObject({ code: 'send_uncertain' });
  await deliverFiles(options);
  expect(relay.startUpload).toHaveBeenCalledTimes(2);
  expect(relay.prompt.mock.calls[1]).toEqual(relay.prompt.mock.calls[0]);
});
it('invalidates receipts on desktop refusal and reuploads before retrying', async () => {
  const { relay, options, draft } = setup();
  await uploadFiles(options);
  relay.prompt.mockRejectedValueOnce(new RelayError('upload_expired'));
  await expect(deliverFiles(options)).rejects.toMatchObject({ code: 'upload_expired' });
  expect(draft.pending?.sent).toBe(false);
  expect(draft.uploaded.size).toBe(0);
  await expect(deliverFiles(options)).rejects.toMatchObject({ code: 'upload_expired' });
  await uploadFiles(options);
  expect(relay.prompt).toHaveBeenCalledTimes(1);
  await deliverFiles(options);
  expect(relay.startUpload).toHaveBeenCalledTimes(4);
});
it('cancels the active transfer before any message can be sent', async () => {
  const { relay, options, controller, draft } = setup();
  relay.uploadChunk.mockImplementationOnce(async () => {
    controller.abort();
    throw new RelayError('upload_expired');
  });
  await expect(uploadFiles(options)).rejects.toMatchObject({ code: 'upload_cancelled' });
  expect(relay.cancelUpload).toHaveBeenCalled();
  expect(relay.prompt).not.toHaveBeenCalled();
  expect(draft.files).toHaveLength(2);
});

it('uploads immediately without prompting and Send reuses every staged receipt', async () => {
  const { relay, options, draft } = setup();
  await uploadFiles(options);
  expect(relay.prompt).not.toHaveBeenCalled();
  expect(draft.pending).toBeUndefined();
  expect(draft.uploaded.size).toBe(2);
  expect(filesReady(draft, 's')).toBe(true);
  expect(filesReady(draft, 'different')).toBe(false);
  await deliverFiles({ ...options, text: 'typed while uploading' });
  expect(relay.startUpload).toHaveBeenCalledTimes(2);
  expect(relay.prompt).toHaveBeenCalledWith('p', 's', 'typed while uploading', {
    requestId: 'stable-id',
    receipts: ['one.txt', 'two.txt'],
  });
});
it('coalesces provisional sessions and ignores a stale resolution after changing destination', async () => {
  let first!: (value: { id: string; directory: string }) => void;
  let second!: (value: { id: string; directory: string }) => void;
  const createSession = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second = resolve;
        }),
    );
  const relay = { createSession } as unknown as RelayClient;
  const draft = newFileDraft();
  draft.options = { cwd: '/a', agentPreset: 'a' };
  const old = ensureFileTarget(relay, 'p', draft);
  const coalesced = ensureFileTarget(relay, 'p', draft);
  expect(createSession).toHaveBeenCalledTimes(1);
  draft.creating = undefined;
  draft.options = { cwd: '/b', agentPreset: 'b' };
  const fresh = ensureFileTarget(relay, 'p', draft);
  first({ id: 'old', directory: 'a' });
  await old;
  await coalesced;
  expect(draft.target).toBeUndefined();
  second({ id: 'fresh', directory: 'b' });
  await fresh;
  expect(draft.target).toEqual({ id: 'fresh', directory: 'b' });
  expect(await ensureFileTarget(relay, 'p', draft)).toEqual(draft.target);
  expect(createSession).toHaveBeenCalledTimes(2);
});
it('reuploads receipts for a different session without submitting a prompt', async () => {
  const { relay, options, draft } = setup();
  await uploadFiles(options);
  await uploadFiles({ ...options, sessionId: 'new-target' });
  expect(relay.startUpload).toHaveBeenCalledTimes(4);
  expect([...draft.uploaded.values()].every((file) => file.sessionId === 'new-target')).toBe(true);
  expect(relay.prompt).not.toHaveBeenCalled();
});

it('refuses Send before uploads finish without starting a transfer or submitting a prompt', async () => {
  const { relay, options, draft } = setup();
  expect(filesReady(draft)).toBe(false);
  expect(filesReady(draft, 's')).toBe(false);
  await expect(deliverFiles(options)).rejects.toMatchObject({ code: 'upload_expired' });
  expect(relay.startUpload).not.toHaveBeenCalled();
  expect(relay.prompt).not.toHaveBeenCalled();
  expect(draft.pending).toBeUndefined();
});
