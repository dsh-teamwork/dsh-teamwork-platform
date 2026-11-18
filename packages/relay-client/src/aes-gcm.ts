/** AES-256-GCM through WebCrypto, for a browser or Node; the phone app passes its native backend instead. */
import type { AesKey } from './secure-channel';

const bytes = (value: Uint8Array) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

export async function webAesKey(raw: Uint8Array): Promise<AesKey> {
  if (raw.length !== 32) throw new Error('invalid_aes_key');
  const key = await globalThis.crypto.subtle.importKey('raw', bytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async encrypt(plaintext, nonce, additionalData) {
      return new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(nonce), additionalData: bytes(additionalData), tagLength: 128 }, key, bytes(plaintext)));
    },
    async decrypt(ciphertext, nonce, additionalData) {
      return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(nonce), additionalData: bytes(additionalData), tagLength: 128 }, key, bytes(ciphertext)));
    },
  };
}
