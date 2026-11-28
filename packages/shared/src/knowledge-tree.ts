/**
 * A team's knowledge tree as the console and the closed phone app read it (`GET …/knowledge`): the
 * flat folders and documents of each space nested, filtered by title (the
 * first version finds a document by its title), and `[[links]]` resolved to
 * the document they name.
 */

import { headingSlug, parseWikiTarget } from './knowledge-format';

/** `GET …/knowledge` as `api/openapi.yaml` states it (`KnowledgeTree` and the schemas it holds). */
export interface KnowledgeFolder {
  id: string;
  /** Empty at the space's root. */
  parentId: string;
  name: string;
}
export interface KnowledgeDocumentSummary {
  id: string;
  /** Empty at the space's root. */
  folderId: string;
  title: string;
  currentVersion: number;
  updatedAt: string;
}
export interface KnowledgeSpace {
  id: string;
  name: string;
  reading: 'team' | 'members';
  canEdit: boolean;
  templatesFolderId: string;
  folders: KnowledgeFolder[];
  documents: KnowledgeDocumentSummary[];
}
export interface KnowledgeTree {
  canCreateSpace: boolean;
  spaces: KnowledgeSpace[];
}

export interface FolderNode {
  folder: KnowledgeFolder;
  folders: FolderNode[];
  documents: KnowledgeDocumentSummary[];
}

/** A space's contents, nested: what sits at its root, and each folder with what is in it. */
export interface SpaceNode {
  space: KnowledgeSpace;
  folders: FolderNode[];
  documents: KnowledgeDocumentSummary[];
}

const matches = (title: string, query: string) => title.toLocaleLowerCase().includes(query);

/**
 * One space nested. With a query, only the documents whose title holds it
 * (ignoring case) stay, and the folders that lead to one. A folder whose
 * parent is missing sits at the root rather than vanishing.
 */
export function nestSpace(space: KnowledgeSpace, query = ''): SpaceNode {
  const q = query.trim().toLocaleLowerCase();
  const ids = new Set(space.folders.map((f) => f.id));
  const build = (parentId: string, seen: Set<string>): FolderNode[] =>
    space.folders
      .filter((f) => (parentId === '' ? f.parentId === '' || !ids.has(f.parentId) : f.parentId === parentId) && !seen.has(f.id))
      .map((folder) => {
        const inner = new Set(seen).add(folder.id);
        return { folder, folders: build(folder.id, inner), documents: space.documents.filter((d) => d.folderId === folder.id && (!q || matches(d.title, q))) };
      })
      .filter((node) => !q || node.documents.length > 0 || node.folders.length > 0);
  return {
    space,
    folders: build('', new Set()),
    documents: space.documents.filter((d) => (d.folderId === '' || !ids.has(d.folderId)) && (!q || matches(d.title, q))),
  };
}

/** Every folder of a space with the names leading to it (`Ops / Runbooks`), in tree order, for choosing where a document goes. */
export function folderPaths(space: KnowledgeSpace): { id: string; path: string[] }[] {
  const out: { id: string; path: string[] }[] = [];
  const walk = (nodes: FolderNode[], path: string[]) => {
    for (const node of nodes) {
      const here = [...path, node.folder.name];
      out.push({ id: node.folder.id, path: here });
      walk(node.folders, here);
    }
  };
  walk(nestSpace(space).folders, []);
  return out;
}

/** Where a document is in the tree, or null when the reader cannot see it. */
export function findDocument(tree: KnowledgeTree, documentId: string): { space: KnowledgeSpace; document: KnowledgeDocumentSummary } | null {
  for (const space of tree.spaces) {
    const document = space.documents.find((d) => d.id === documentId);
    if (document) return { space, document };
  }
  return null;
}

/** What a `[[…]]` link opens: a document of the team and the heading's anchor, or null when no document the reader sees has that title. */
export interface ResolvedLink {
  documentId: string;
  anchor: string;
  label: string;
}

/**
 * Resolves a `[[Title]]` or `[[Title#Heading]]` link over the tree by title:
 * an exact title first, then one that differs only in case, and among
 * several, the one in the space the link is written in. `[[#Heading]]` is a
 * heading of the document itself.
 */
export function resolveWikiLink(tree: KnowledgeTree, raw: string, from: { spaceId: string; documentId: string }): ResolvedLink | null {
  const target = parseWikiTarget(raw);
  const anchor = target.heading ? headingSlug(target.heading) : '';
  if (!target.title) return target.heading ? { documentId: from.documentId, anchor, label: target.label } : null;
  const all = tree.spaces.flatMap((space) => space.documents.map((document) => ({ space, document })));
  const lower = target.title.toLocaleLowerCase();
  for (const same of [(t: string) => t === target.title, (t: string) => t.toLocaleLowerCase() === lower]) {
    const found = all.filter((c) => same(c.document.title));
    if (found.length > 0) {
      const pick = found.find((c) => c.space.id === from.spaceId) ?? found[0];
      return { documentId: pick.document.id, anchor, label: target.label };
    }
  }
  return null;
}
