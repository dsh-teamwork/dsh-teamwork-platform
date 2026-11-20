/**
 * Which PIN prompt the gate draws (components/pin-gate.tsx) for a computer's lock: none while it is open or has not
 * said; setting a first PIN, then typing it again; entering it; or locked out.
 */
import type { PinState } from './types';

export type PinPrompt = 'set' | 'confirm' | 'enter' | 'locked';

export function pinPrompt(state: PinState | undefined, confirming: boolean): PinPrompt | null {
  if (!state || state.kind === 'unlocked') return null;
  if (state.kind === 'locked') return 'locked';
  if ((state.kind === 'required' && state.set) || state.kind === 'invalid') return confirming ? 'confirm' : 'set';
  return 'enter';
}

/** A host reached over HTTP reports its current PIN state to all open views. */
export function createPinClient(request: (body: Record<string, string>) => Promise<PinState>) {
  let state: PinState | undefined;
  let revision = 0;
  const listeners = new Set<(value: PinState | undefined) => void>();
  async function send(body: Record<string, string>) {
    const current = ++revision;
    const result = await request(body);
    if (current === revision) {
      state = result;
      for (const listener of listeners) listener(state);
    }
    return result;
  }
  return {
    watchPin(_id: string, listener: (value: PinState | undefined) => void) {
      listeners.add(listener);
      listener(state);
      void send({ action: 'status' }).catch(() => {});
      return () => { listeners.delete(listener); };
    },
    unlock(_id: string, pin: string) { return send({ action: 'unlock', pin }); },
    setPin(_id: string, pin: string, old?: string) {
      return send(old === undefined ? { action: 'enable', pin } : { action: 'change', pin, old });
    },
    refresh() { return send({ action: 'status' }); },
  };
}
