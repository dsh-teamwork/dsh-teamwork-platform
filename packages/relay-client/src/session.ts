import { applyChange, settleTool, toolArtifact } from './dsh';
import type { ConversationItem, SessionEvent, SessionState } from './types';

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
      const earlier = event.items.filter((item) => !shown.has(item.id));
      const calls = new Map(earlier.flatMap((item, index) => item.kind === 'tool' ? [[item.id, index] as const] : []));
      const current = state.items.flatMap<ConversationItem>((item) => {
        if (item.kind !== 'tool-result') return [item];
        const index = calls.get(item.callId);
        const call = index === undefined ? undefined : earlier[index];
        if (index === undefined || call?.kind !== 'tool') return [item];
        const settled = settleTool(call, item.result);
        earlier[index] = settled;
        const artifact = toolArtifact(settled, item.result);
        return artifact ? [artifact] : [];
      });
      return { ...state, items: [...earlier, ...current], earlier: event.earlier };
    }
    default:
      return applyChange(state, event);
  }
}
