import { describe, expect, it } from 'vitest';

import { diffStats, diffText, foldDiff } from '../knowledge-diff';

describe('the line difference', () => {
  it('numbers each side and marks what changed', () => {
    expect(diffText('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { kind: 'same', text: 'a', before: 1, after: 1 },
      { kind: 'removed', text: 'b', before: 2 },
      { kind: 'added', text: 'B', after: 2 },
      { kind: 'same', text: 'c', before: 3, after: 3 },
      { kind: 'added', text: 'd', after: 4 },
    ]);
  });

  it('folds long unchanged runs into gaps around the changes', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const after = before.replace('line 10\n', 'line ten\n');
    const rows = foldDiff(diffText(before, after), 2);
    expect(rows[0]).toEqual({ kind: 'gap', lines: 7 });
    expect(rows.flatMap((r) => (r.kind === 'gap' ? [] : [r.text]))).toEqual(['line 8', 'line 9', 'line 10', 'line ten', 'line 11', 'line 12']);
    expect(rows[rows.length - 1]).toEqual({ kind: 'gap', lines: 8 });
    expect(diffStats(diffText(before, after))).toEqual({ added: 1, removed: 1 });
  });

  it('is empty for equal texts', () => {
    expect(foldDiff(diffText('same\n', 'same\n'))).toEqual([]);
  });
});
