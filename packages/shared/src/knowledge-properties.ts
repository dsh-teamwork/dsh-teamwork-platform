/**
 * A document's properties (docs/tech/knowledge.md, "Format"): `owner`,
 * `status`, `tags` and `summary` in its YAML front matter, which an agent
 * reads as text and a person sees as a row under the title. Editing them
 * rewrites only the keys that changed, so any other key, comment or order a
 * person or an agent wrote stays as it was. The owner is a member, written as a mention
 * (`@[Ada](member-id)`) so the file names them to a reader and to the
 * console alike; a plain name someone typed is kept and shown as written.
 */

import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';

export interface Properties {
  owner: string;
  status: string;
  tags: string[];
  summary: string;
}

export const NO_PROPERTIES: Properties = { owner: '', status: '', tags: [], summary: '' };

/** The front matter's parts: its YAML, and the line breaks after its closing `---`. */
const PARTS = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)((?:\r?\n)*)$/;

function yamlOf(frontMatter: string): { yaml: string; after: string } | null {
  if (!frontMatter) return { yaml: '', after: '\n' };
  const m = PARTS.exec(frontMatter);
  return m ? { yaml: m[1], after: m[2] } : null;
}

function documentOf(frontMatter: string): Document | null {
  const parts = yamlOf(frontMatter);
  if (!parts) return null;
  const doc = parseDocument(parts.yaml);
  if (doc.errors.length > 0) return null;
  if (doc.contents !== null && !isMap(doc.contents)) return null;
  return doc;
}

const text = (value: unknown) => (value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value).trim());

/**
 * The properties a front matter holds, or null when it is not YAML a mapping
 * can be read from, which the console then leaves alone. Tags are a list, or
 * one comma-separated line.
 */
export function readProperties(frontMatter: string): Properties | null {
  const doc = documentOf(frontMatter);
  if (!doc) return null;
  const tags = doc.get('tags', true);
  const list = isSeq(tags) ? tags.items.map((item) => text(isScalar(item) ? item.value : item)) : isScalar(tags) ? text(tags.value).split(',') : [];
  return {
    owner: text(doc.get('owner')),
    status: text(doc.get('status')),
    tags: list.map((tag) => tag.trim()).filter(Boolean),
    summary: text(doc.get('summary')),
  };
}

/**
 * The front matter with these properties: each set, or removed when empty,
 * everything else as it was. A document with no front matter gets one only
 * when a property is set, and loses it when its last key goes.
 */
export function writeProperties(frontMatter: string, props: Properties): string {
  const doc = documentOf(frontMatter);
  const parts = yamlOf(frontMatter);
  if (!doc || !parts) return frontMatter;
  const before = readProperties(frontMatter) ?? NO_PROPERTIES;
  if (doc.contents === null) doc.contents = doc.createNode({});
  // A key whose value did not change keeps how it was written.
  const set = (key: 'owner' | 'status' | 'summary', value: string) => {
    if (value.trim() === before[key]) return;
    if (value.trim()) doc.set(key, value.trim());
    else doc.delete(key);
  };
  set('owner', props.owner);
  set('status', props.status);
  const tags = props.tags.map((tag) => tag.trim()).filter(Boolean);
  if (tags.join('\n') !== before.tags.join('\n')) {
    if (tags.length > 0) {
      const node = doc.createNode(tags);
      node.flow = true;
      doc.set('tags', node);
    } else {
      doc.delete('tags');
    }
  }
  set('summary', props.summary);
  if (isMap(doc.contents) && doc.contents.items.length === 0 && !doc.commentBefore && !doc.contents.commentBefore) return '';
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${parts.after}`;
}

/** A member an owner names: the id of a mention, and the name it was written with; or the text alone, naming no one. */
export function parseOwner(owner: string): { id: string; name: string } {
  const m = /^@\[([^\]]*)\]\(([^)\s]+)\)$/.exec(owner.trim());
  return m ? { id: m[2], name: m[1] } : { id: '', name: owner.trim() };
}

/** An owner written as a mention of a member. */
export function ownerMention(id: string, name: string): string {
  return `@[${name.replace(/[[\]]/g, '')}](${id})`;
}
