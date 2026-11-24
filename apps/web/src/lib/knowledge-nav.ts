/**
 * What the sidebar lists under Knowledge (docs/tech/knowledge.md, "The
 * console"): the team's spaces the reader reads, whether they may create one,
 * and the space open on the knowledge page. The knowledge page publishes it
 * whenever it reads the tree, so the two never disagree; elsewhere the
 * sidebar reads the tree once itself. It lives outside both, in the
 * console's main bundle, so the sidebar never loads the editor.
 */

import { useSyncExternalStore } from 'react';

export interface NavSpace {
  id: string;
  name: string;
  reading: 'team' | 'members';
}

export interface KnowledgeNav {
  teamId: string;
  spaces: NavSpace[];
  canCreateSpace: boolean;
  /** The space open on the knowledge page, or empty. */
  current: string;
}

let state: KnowledgeNav | null = null;
let key = '';
const listeners = new Set<() => void>();

/** Tells the sidebar what the knowledge page shows; the same again changes nothing. */
export function publishKnowledgeNav(next: KnowledgeNav) {
  const nextKey = JSON.stringify(next);
  if (nextKey === key) return;
  key = nextKey;
  state = next;
  for (const listener of listeners) listener();
}

/** What was last published, or null before anything was. */
export function useKnowledgeNav(): KnowledgeNav | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => null,
  );
}

/** The last published state, read outside React. */
export function knowledgeNav(): KnowledgeNav | null {
  return state;
}
