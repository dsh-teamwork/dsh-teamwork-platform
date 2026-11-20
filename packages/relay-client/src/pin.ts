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
  let queue: Promise<unknown> = Promise.resolve();
  let refresh: Promise<PinState> | undefined;
  const listeners = new Set<(value: PinState | undefined) => void>();
  function send(body: Record<string, string>): Promise<PinState> {
    if (body.action === 'status' && refresh) return refresh;
    // A status read after an unlock observes the committed grant, even if multiple
    // views subscribe at once or a stream is reconnecting.
    const task = queue.then(async () => {
      state = await request(body);
      for (const listener of listeners) listener(state);
      return state;
    });
    queue = task.catch(() => {});
    refresh = body.action === 'status' ? task : undefined;
    const finished = () => { if (refresh === task) refresh = undefined; };
    void task.then(finished, finished);
    return task;
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
