/**
 * Provider keys at rest (ADR 0006): AES-256-GCM under `PROVIDER_KEYS_SECRET`,
 * 32 random bytes in base64, which `npx` generates and every other deployment
 * sets. Each ciphertext is bound to its team and provider name, so a row
 * copied to another team or renamed no longer decrypts.
 *
 * Losing the secret loses every stored provider key and nothing else: teams
 * enter their keys again. The secret is never derived from AUTH_SECRET, so
 * rotating one never costs the other.
 */

import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { TeamError } from '@/lib/team';

const VERSION = 'v1';

function secret(): Buffer {
  const raw = process.env.PROVIDER_KEYS_SECRET?.trim();
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new TeamError(503, 'provider_keys_unavailable');
  return key;
}

const bound = (teamId: string, name: string) => Buffer.from(`${teamId}\n${name}`);

/** `v1.iv.tag.ciphertext`, each base64url. */
export function encryptProviderKey(teamId: string, name: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), iv);
  cipher.setAAD(bound(teamId, name));
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

/** The key, or `provider_keys_unavailable` when the secret is missing or is not the one it was sealed with. */
export function decryptProviderKey(teamId: string, name: string, sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new TeamError(503, 'provider_keys_unavailable');
  try {
    const decipher = createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(bound(teamId, name));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof TeamError) throw error;
    throw new TeamError(503, 'provider_keys_unavailable');
  }
}
