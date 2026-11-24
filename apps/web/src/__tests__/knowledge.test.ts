import { describe, expect, it } from 'vitest';

import { diffStats, diffText, foldDiff } from '@/lib/knowledge-diff';
import { FORMATTING_NOTE, headingSlug, joinFrontMatter, parseWikiTarget, planSave, splitFrontMatter } from '@/lib/knowledge-format';
import { findDocument, folderPaths, nestSpace, resolveWikiLink, type KnowledgeSpace, type KnowledgeTree } from '@/lib/knowledge-tree';

const at = '2026-11-24T00:00:00Z';
const doc = (id: string, title: string, folderId = '') => ({ id, title, folderId, currentVersion: 1, updatedAt: at });
const ops: KnowledgeSpace = {
  id: 'ops',
  name: 'Ops',
  reading: 'team',
  canEdit: true,
  folders: [
    { id: 'f1', parentId: '', name: 'Runbooks' },
    { id: 'f2', parentId: 'f1', name: 'Gateway' },
    { id: 'f3', parentId: '', name: 'Empty' },
    { id: 'f4', parentId: 'gone', name: 'Orphan' },
  ],
  documents: [doc('d1', 'Glossary'), doc('d2', 'Deploys', 'f1'), doc('d3', 'Rate limits', 'f2'), doc('d4', 'Old notes', 'f4')],
};
const product: KnowledgeSpace = { id: 'product', name: 'Product', reading: 'members', canEdit: false, folders: [], documents: [doc('d5', 'glossary'), doc('d6', 'Pricing')] };
const tree: KnowledgeTree = { canCreateSpace: true, spaces: [ops, product] };

describe('front matter', () => {
  it('is split off exactly and put back', () => {
    const text = '---\nowner: ops\nstatus: draft\n---\n\n# Title\n\nBody\n';
    const { frontMatter, body } = splitFrontMatter(text);
    expect(frontMatter).toBe('---\nowner: ops\nstatus: draft\n---\n\n');
    expect(body).toBe('# Title\n\nBody\n');
    expect(joinFrontMatter(frontMatter, body)).toBe(text);
  });

  it('is only front matter at the very start', () => {
    for (const text of ['# Title\n\n---\na: b\n---\n', '\n---\na: b\n---\n', '---\nnot closed\n']) {
      expect(splitFrontMatter(text)).toEqual({ frontMatter: '', body: text });
    }
  });

  it('may end the file', () => {
    expect(splitFrontMatter('---\na: b\n---')).toEqual({ frontMatter: '---\na: b\n---', body: '' });
  });
});

describe('links between documents', () => {
  it('read a title, a heading and an alias', () => {
    expect(parseWikiTarget('Glossary')).toEqual({ title: 'Glossary', heading: '', label: 'Glossary' });
    expect(parseWikiTarget('Glossary#Release train')).toEqual({ title: 'Glossary', heading: 'Release train', label: 'Glossary › Release train' });
    expect(parseWikiTarget('Glossary#Preset|presets')).toEqual({ title: 'Glossary', heading: 'Preset', label: 'presets' });
    expect(parseWikiTarget('#Steps').label).toBe('Steps');
  });

  it('cite a heading by its slug, in every script', () => {
    expect(headingSlug('  Release train: v2  ')).toBe('release-train:-v2');
    expect(headingSlug('API_keys and   tokens')).toBe('api_keys-and-tokens');
    const chinese = String.fromCodePoint(0x53d1, 0x5e03, 0x6d41, 0x7a0b);
    expect(headingSlug(`${chinese} 2`)).toBe(`${chinese}-2`);
  });

  it('resolve by exact title first, then ignoring case, preferring the space they are written in', () => {
    const fromOps = { spaceId: 'ops', documentId: 'd2' };
    expect(resolveWikiLink(tree, 'Glossary', fromOps)).toEqual({ documentId: 'd1', anchor: '', label: 'Glossary' });
    expect(resolveWikiLink(tree, 'glossary', fromOps)?.documentId).toBe('d5');
    expect(resolveWikiLink(tree, 'GLOSSARY', fromOps)?.documentId).toBe('d1');
    expect(resolveWikiLink(tree, 'GLOSSARY', { spaceId: 'product', documentId: 'd6' })?.documentId).toBe('d5');
    expect(resolveWikiLink(tree, 'Pricing#Seat price', fromOps)).toEqual({ documentId: 'd6', anchor: 'seat-price', label: 'Pricing › Seat price' });
  });

  it('point at the document itself for a bare heading, and nowhere for an unknown title', () => {
    expect(resolveWikiLink(tree, '#Steps', { spaceId: 'ops', documentId: 'd2' })).toEqual({ documentId: 'd2', anchor: 'steps', label: 'Steps' });
    expect(resolveWikiLink(tree, 'Nobody wrote this', { spaceId: 'ops', documentId: 'd2' })).toBeNull();
  });
});

describe('the tree', () => {
  it('nests folders and keeps an orphan at the root', () => {
    const node = nestSpace(ops);
    expect(node.documents.map((d) => d.id)).toEqual(['d1']);
    expect(node.folders.map((f) => f.folder.name)).toEqual(['Runbooks', 'Empty', 'Orphan']);
    expect(node.folders[0].documents.map((d) => d.id)).toEqual(['d2']);
    expect(node.folders[0].folders[0].documents.map((d) => d.id)).toEqual(['d3']);
    expect(node.folders[2].documents.map((d) => d.id)).toEqual(['d4']);
  });

  it('filters by title, keeping only the folders that lead to a match', () => {
    const node = nestSpace(ops, ' LIMIT ');
    expect(node.documents).toEqual([]);
    expect(node.folders.map((f) => f.folder.name)).toEqual(['Runbooks']);
    expect(node.folders[0].documents).toEqual([]);
    expect(node.folders[0].folders[0].documents.map((d) => d.title)).toEqual(['Rate limits']);
  });

  it('lists every folder by its path, and finds a document', () => {
    expect(folderPaths(ops).map((f) => f.path.join(' / '))).toEqual(['Runbooks', 'Runbooks / Gateway', 'Empty', 'Orphan']);
    expect(findDocument(tree, 'd6')?.space.id).toBe('product');
    expect(findDocument(tree, 'nope')).toBeNull();
  });
});

describe('saving over the editor normalisation', () => {
  const stored = '* one\n* two\n';
  const normalised = '- one\n- two\n';

  it('saves only the change when the editor keeps the stored syntax', () => {
    expect(planSave(normalised, normalised, '- one\n- three\n', 'Fix')).toEqual([{ text: '- one\n- three\n', note: 'Fix' }]);
  });

  it('records the normalisation first, as its own version, then the change', () => {
    expect(planSave(stored, normalised, '- one\n- three\n', 'Fix')).toEqual([
      { text: normalised, note: FORMATTING_NOTE },
      { text: '- one\n- three\n', note: 'Fix' },
    ]);
  });

  it('saves the normalisation alone when nothing else changed, and nothing when nothing did', () => {
    expect(planSave(stored, normalised, normalised, 'Fix')).toEqual([{ text: normalised, note: FORMATTING_NOTE }]);
    expect(planSave(normalised, normalised, normalised, 'Fix')).toEqual([]);
  });
});

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
