/**
 * The part of the relay's frames the app reads (docs/tech/relay.md,
 * "Frames"). The relay's own definition is `server/relay/protocol.go`;
 * a change there changes this file, and the plugin's `src/relay.ts` and
 * `src/bridge.ts`, in the same working session.
 */
import { z } from 'zod';

/** The phone's socket, under the relay's origin. */
export const PHONE_PATH = '/phone';

const pairingId = z.string().min(1).max(64);
const callId = z.string().min(1).max(64);

/** What a computer sends back for a phone: a call's result, or one frame of a stream. */
export const HostFrameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('result'), pairingId, id: callId, status: z.number().int(), body: z.unknown() }),
  z.object({ t: z.literal('mux'), pairingId, body: z.unknown() }),
]);

/**
 * Sent to a phone unasked: a frame was refused (`id` names the call, when it
 * was one); the pairing was revoked; its computer went away, closing every
 * stream; another socket of this handset took the pairing over; or one of the member's computers came or went.
 */
export type PhoneEvent =
  | { t: 'error'; pairingId: string; id?: string; error: 'not_paired' | 'offline' | 'rate_limited' }
  | { t: 'revoked'; pairingId: string }
  | { t: 'offline'; pairingId: string }
  | { t: 'detached'; pairingId: string }
  /** One of the member's computers connected or left: list them again. */
  | { t: 'presence'; hostId: string };
