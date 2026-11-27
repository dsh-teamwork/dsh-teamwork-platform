import { describe, expect, it } from 'vitest';

import {
  attachmentNameOf,
  attachmentNamesIn,
  attachmentUrl,
  FORMATTING_NOTE,
  headingSlug,
  isAttachmentName,
  isImageName,
  joinFrontMatter,
  parseWikiTarget,
  pastedName,
  planSave,
  splitFrontMatter,
  suggestAttachmentName,
} from '@/lib/knowledge-format';
import { findDocument, folderPaths, nestSpace, resolveWikiLink, type KnowledgeSpace, type KnowledgeTree } from '@/lib/knowledge-tree';

const at = '2026-11-24T00:00:00Z';
const doc = (id: string, title: string, folderId = '') => ({ id, title, folderId, currentVersion: 1, updatedAt: at });
const ops: KnowledgeSpace = {
  id: 'ops',
  name: 'Ops',
  reading: 'team',
  canEdit: true,
  templatesFolderId: '',
  folders: [
    { id: 'f1', parentId: '', name: 'Runbooks' },
    { id: 'f2', parentId: 'f1', name: 'Gateway' },
    { id: 'f3', parentId: '', name: 'Empty' },
    { id: 'f4', parentId: 'gone', name: 'Orphan' },
  ],
  documents: [doc('d1', 'Glossary'), doc('d2', 'Deploys', 'f1'), doc('d3', 'Rate limits', 'f2'), doc('d4', 'Old notes', 'f4')],
};
const product: KnowledgeSpace = { id: 'product', name: 'Product', reading: 'members', canEdit: false, templatesFolderId: '', folders: [], documents: [doc('d5', 'glossary'), doc('d6', 'Pricing')] };
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

describe('attachments', () => {
  it('are told from a document link by an allowed extension, in any case', () => {
    for (const name of ['diagram.png', 'Photo.JPG', 'a.jpeg', 'spec.pdf', 'data.csv', 'deck.pptx', 'all.zip', 'icon.svg']) expect(isAttachmentName(name)).toBe(true);
    for (const name of ['Pricing', 'Release 1.2', 'notes.md', 'movie.mp4', '.png', 'png']) expect(isAttachmentName(name)).toBe(false);
    expect(['a.png', 'b.WEBP', 'c.avif', 'd.svg'].every(isImageName)).toBe(true);
    expect(['a.pdf', 'b.txt', 'Pricing'].some(isImageName)).toBe(false);
  });

  it('are the names a text gives them, embedded or linked, each once', () => {
    const text = '![[diagram.png]] and [[spec.pdf|the spec]], [[Pricing]], [[Glossary#Terms]], again [[diagram.png]] and [[data.csv]]';
    expect(attachmentNamesIn(text)).toEqual(['diagram.png', 'spec.pdf', 'data.csv']);
  });

  it('are read from their document by an encoded name', () => {
    expect(attachmentUrl('t 1', 'd/1', 'Q3 plan #2 (final).pdf')).toBe('/api/teams/t%201/knowledge/documents/d%2F1/attachments/Q3%20plan%20%232%20(final).pdf');
    expect(attachmentUrl('t', 'd', '\u67b6\u6784\u56fe.png')).toBe('/api/teams/t/knowledge/documents/d/attachments/%E6%9E%B6%E6%9E%84%E5%9B%BE.png');
  });

  it('keep a file name a link can hold', () => {
    expect(attachmentNameOf(' plan [v2] | draft #1^.pdf ')).toBe('plan -v2- - draft -1-.pdf');
    expect(attachmentNameOf('a/b\\c.png')).toBe('a-b-c.png');
  });

  it('name a pasted image as Obsidian does', () => {
    expect(pastedName(new Date(2026, 10, 4, 9, 5, 7), 'png')).toBe('Pasted image 20261104090507.png');
  });

  it('offer the next free numbered name when a name is taken', () => {
    expect(suggestAttachmentName('diagram.png', ['diagram.png'])).toBe('diagram (2).png');
    expect(suggestAttachmentName('diagram.png', ['diagram.png', 'diagram (2).png', 'diagram (3).png'])).toBe('diagram (4).png');
    expect(suggestAttachmentName('diagram (2).png', ['diagram.png', 'diagram (2).png'])).toBe('diagram (3).png');
    expect(suggestAttachmentName('archive.tar.zip', [])).toBe('archive.tar (2).zip');
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
