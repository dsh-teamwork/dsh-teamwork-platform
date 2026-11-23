/**
 * A device identity whose Ed25519 private key is a WebCrypto key made non-extractable: a page keeps the key in
 * IndexedDB and can sign with it, but no script, its own included, can read it out. Noise only signs with the key and reads its public half, so this wrapper is all it needs.
 */
import { publicKeyFromRaw, publicKeyToProtobuf } from '@libp2p/crypto/keys';
import { base64, type Identity } from './secure-channel';

/** A new key pair for `webCryptoIdentity`, its private half unreadable. */
export function newWebCryptoKeyPair(): Promise<CryptoKeyPair> {
  return globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as Promise<CryptoKeyPair>;
}

export async function webCryptoIdentity(pair: CryptoKeyPair): Promise<Identity> {
  const publicKey = publicKeyFromRaw(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey)));
  if (publicKey.type !== 'Ed25519') throw new Error('invalid_identity');
  const privateKey = {
    type: 'Ed25519' as const,
    publicKey,
    get raw(): Uint8Array {
      throw new Error('non_extractable');
    },
    equals: (other: unknown) => other === privateKey,
    async sign(data: Uint8Array | { subarray(): Uint8Array }) {
      const bytes = data instanceof Uint8Array ? data : data.subarray();
      return new Uint8Array(await globalThis.crypto.subtle.sign('Ed25519', pair.privateKey, bytes.slice()));
    },
  };
  return { privateKey: privateKey as unknown as Identity['privateKey'], publicKey: base64(publicKeyToProtobuf(publicKey)) };
}
