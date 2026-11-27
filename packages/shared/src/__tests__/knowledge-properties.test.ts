import { describe, expect, it } from 'vitest';

import { NO_PROPERTIES, ownerMention, parseOwner, readProperties, writeProperties } from '../knowledge-properties';

describe("a knowledge document's properties", () => {
  const front = '---\n# who to ask\nowner: "@[Ada](u1)"\nreviewed: 2026-11-01\ntags: [deploys, ops]\n---\n\n';

  it('reads the four it knows, a tag list or a line of tags', () => {
    expect(readProperties(front)).toEqual({ owner: '@[Ada](u1)', status: '', tags: ['deploys', 'ops'], summary: '' });
    expect(readProperties('---\ntags: a, b\nstatus: draft\n---\n')?.tags).toEqual(['a', 'b']);
    expect(readProperties('')).toEqual(NO_PROPERTIES);
  });

  it('leaves front matter alone that is not a mapping', () => {
    expect(readProperties('---\n- a\n- b\n---\n')).toBeNull();
    expect(readProperties('---\nowner: [unclosed\n---\n')).toBeNull();
    expect(writeProperties('---\n- a\n---\n', { ...NO_PROPERTIES, status: 'x' })).toBe('---\n- a\n---\n');
  });

  it('changes only its own keys, keeping comments, order and the rest', () => {
    const out = writeProperties(front, { owner: '@[Ada](u1)', status: 'current', tags: ['deploys'], summary: 'How we ship.' });
    expect(out).toBe('---\n# who to ask\nowner: "@[Ada](u1)"\nreviewed: 2026-11-01\ntags: [deploys]\nstatus: current\nsummary: How we ship.\n---\n\n');
    expect(readProperties(out)?.summary).toBe('How we ship.');
    // A list written as a block stays one while its tags stay the same.
    const block = '---\ntags:\n  - a\n  - b\n---\n';
    expect(writeProperties(block, { ...NO_PROPERTIES, tags: ['a', 'b'], status: 'draft' })).toBe('---\ntags:\n  - a\n  - b\nstatus: draft\n---\n');
  });

  it('adds front matter only for a property, and drops it with the last key', () => {
    expect(writeProperties('', NO_PROPERTIES)).toBe('');
    const made = writeProperties('', { ...NO_PROPERTIES, owner: ownerMention('u2', 'Bo [ops]') });
    expect(made).toBe('---\nowner: "@[Bo ops](u2)"\n---\n\n');
    expect(writeProperties(made, NO_PROPERTIES)).toBe('');
  });

  it('reads an owner as a mention of a member, or as plain text', () => {
    expect(parseOwner('@[Ada](u1)')).toEqual({ id: 'u1', name: 'Ada' });
    expect(parseOwner(' Ops team ')).toEqual({ id: '', name: 'Ops team' });
  });
});

describe('a line of a document as a list shows it', () => {
  it('reads mentions as names and links as their words', async () => {
    const { readableLine } = await import('../knowledge-format');
    const nameOf = (id: string) => (id === 'user1' ? 'ada@example.com' : null);
    expect(readableLine('Ask @[Ada](user1) or @[Bo](gone2) about [[Pricing#Tiers|tiers]] and ![[chart.png]].', nameOf)).toBe('Ask @ada@example.com or @Bo about tiers and chart.png.');
  });
});
