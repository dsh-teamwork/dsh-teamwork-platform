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
