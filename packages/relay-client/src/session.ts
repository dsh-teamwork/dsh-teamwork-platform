import { applyChange } from './dsh';
import type { SessionEvent, SessionState } from './types';

export const EMPTY_SESSION: SessionState = { status: 'idle', items: [], pending: null, closed: null, earlier: null };

/** Folds one `follow` event into the state a session screen draws. Pure, so a reducer can use it. */
export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'snapshot':
      return event.state;
    case 'pending':
      return { ...state, pending: event.pending };
    case 'closed':
      return { ...state, closed: event.reason };
    case 'older': {
      const shown = new Set(state.items.map((item) => item.id));
      return { ...state, items: [...event.items.filter((item) => !shown.has(item.id)), ...state.items], earlier: event.earlier };
    }
    default:
      return applyChange(state, event);
  }
}
