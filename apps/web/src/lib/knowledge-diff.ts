/**
 * The difference between two texts of a document, line by line, for comparing
 * versions, deciding a proposal and reapplying a stale save
 * (components/knowledge-diff.tsx draws it). Long runs of unchanged lines fold
 * away, leaving a few lines of context around each change.
 */

import { diffLines } from 'diff';

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
  /** The line's number in the old text, for a line that is in it. */
  before?: number;
  /** The line's number in the new text, for a line that is in it. */
  after?: number;
}

/** A run of unchanged lines folded away. */
export interface DiffGap {
  kind: 'gap';
  lines: number;
}

export type DiffRow = DiffLine | DiffGap;

const lines = (value: string) => {
  const out = value.split('\n');
  if (out[out.length - 1] === '') out.pop();
  return out;
};

/** Every line of both texts in order, each marked kept, added or removed. */
export function diffText(before: string, after: string): DiffLine[] {
  const out: DiffLine[] = [];
  let a = 1;
  let b = 1;
  for (const change of diffLines(before, after)) {
    for (const text of lines(change.value)) {
      if (change.added) out.push({ kind: 'added', text, after: b++ });
      else if (change.removed) out.push({ kind: 'removed', text, before: a++ });
      else out.push({ kind: 'same', text, before: a++, after: b++ });
    }
  }
  return out;
}

/**
 * The lines to show: every change with `context` unchanged lines on each side,
 * and each longer unchanged run folded into a gap. No change at all is an
 * empty list.
 */
export function foldDiff(all: DiffLine[], context = 3): DiffRow[] {
  if (!all.some((l) => l.kind !== 'same')) return [];
  const near = all.map(() => false);
  all.forEach((line, i) => {
    if (line.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(all.length - 1, i + context); j++) near[j] = true;
  });
  const out: DiffRow[] = [];
  let hidden = 0;
  all.forEach((line, i) => {
    if (near[i]) {
      if (hidden) out.push({ kind: 'gap', lines: hidden });
      hidden = 0;
      out.push(line);
    } else hidden++;
  });
  if (hidden) out.push({ kind: 'gap', lines: hidden });
  return out;
}

/** How many lines a change adds and removes, for a one-line summary. */
export function diffStats(all: DiffLine[]): { added: number; removed: number } {
  return { added: all.filter((l) => l.kind === 'added').length, removed: all.filter((l) => l.kind === 'removed').length };
}
