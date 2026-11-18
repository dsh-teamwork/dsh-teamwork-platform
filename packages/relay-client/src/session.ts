import type { SessionEvent, SessionState } from './types';

export const EMPTY_SESSION: SessionState = { status: 'idle', items: [], pending: null, closed: null };

/** Folds one `follow` event into the state a session screen draws. Pure, so a reducer can use it. */
export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'snapshot':
      return event.state;
    case 'item': {
      const at = state.items.findIndex((item) => item.id === event.item.id);
      if (at === -1) return { ...state, items: [...state.items, event.item] };
      const items = state.items.slice();
      items[at] = event.item;
      return { ...state, items };
    }
    case 'delta':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === event.id && item.kind === 'assistant' ? { ...item, text: item.text + event.text } : item,
        ),
      };
    case 'status':
      return { ...state, status: event.status };
    case 'pending':
      return { ...state, pending: event.pending };
    case 'closed':
      return { ...state, closed: event.reason };
  }
}
