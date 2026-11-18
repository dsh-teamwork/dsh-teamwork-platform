import { applyChange } from './dsh';
import type { SessionEvent, SessionState } from './types';

export const EMPTY_SESSION: SessionState = { status: 'idle', items: [], pending: null, closed: null };

/** Folds one `follow` event into the state a session screen draws. Pure, so a reducer can use it. */
export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'snapshot':
      return event.state;
    case 'pending':
      return { ...state, pending: event.pending };
    case 'closed':
      return { ...state, closed: event.reason };
    default:
      return applyChange(state, event);
  }
}
