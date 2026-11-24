/**
 * The knowledge page's first column: the spaces the reader reads, each with
 * its folders nested and its documents, found by title; the proposals
 * waiting on the reader; and, for an editor, making and naming what is in a
 * space. The team's admin alone makes a space (docs/tech/knowledge.md,
 * "Rules").
 */

import { ChevronRight, FilePlus, FileText, Folder, FolderPlus, GitPullRequestArrow, Lock, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type Schemas, type Team } from '@/lib/api';
import { nestSpace, type FolderNode, type KnowledgeDocumentSummary, type KnowledgeSpace, type KnowledgeTree } from '@/lib/knowledge-tree';
import { cn } from '@/lib/utils';

import { ActionMenu, NameDialog } from './shared';
import { SpaceSettingsDialog } from './space-settings';

/** What a name dialog is open for. */
type Naming =
  | { kind: 'space' }
  | { kind: 'folder'; space: KnowledgeSpace; parentId: string }
  | { kind: 'document'; space: KnowledgeSpace; folderId: string }
  | { kind: 'renameFolder'; folder: Schemas['KnowledgeFolder'] };

export function KnowledgeTreePanel({ team, tree, error, reload, openId, proposalsOpen, pending }: {
  team: Team;
  tree?: KnowledgeTree;
  error?: unknown;
  reload: () => Promise<unknown>;
  /** The open document. */
  openId: string;
  proposalsOpen: boolean;
  /** Proposals waiting on this reader's decision. */
  pending: number;
}) {
  const t = useTranslations('team.knowledge');
  const word = useTeamError();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState<Naming | null>(null);
  const [settings, setSettings] = useState<KnowledgeSpace | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const base = `teams/${encodeURIComponent(team.id)}/knowledge`;
  const page = `/teams/${team.id}/knowledge`;
  const searching = query.trim() !== '';

  const toggle = (id: string) => setFolded((was) => {
    const next = new Set(was);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  async function deleteFolder(folder: Schemas['KnowledgeFolder']) {
    if (!window.confirm(t('folderDeleteConfirm', { name: folder.name }))) return;
    try {
      await api(`${base}/folders/${encodeURIComponent(folder.id)}`, { method: 'DELETE' });
      toast.success(t('folderDeleted', { name: folder.name }));
    } catch (error) {
      toast.error(word(error));
    }
    await reload();
  }

  const documentLink = (d: KnowledgeDocumentSummary, depth: number) => (
    <Link
      key={d.id}
      to={`${page}/${d.id}`}
      aria-current={d.id === openId ? 'page' : undefined}
      className={cn('flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm', d.id === openId ? 'bg-accent font-medium' : 'hover:bg-accent/50')}
      style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{d.title}</span>
    </Link>
  );

  const folder = (space: KnowledgeSpace, node: FolderNode, depth: number) => {
    const open = searching || !folded.has(node.folder.id);
    return (
      <div key={node.folder.id} className="flex flex-col">
        <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-accent/50" style={{ paddingLeft: `${0.25 + depth * 0.875}rem` }}>
          <button type="button" aria-expanded={open} onClick={() => toggle(node.folder.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm">
            <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{node.folder.name}</span>
          </button>
          {space.canEdit && (
            <ActionMenu
              label={t('folderActions', { name: node.folder.name })}
              items={[
                { label: t('newDocument'), icon: <FilePlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'document', space, folderId: node.folder.id }) },
                { label: t('newFolder'), icon: <FolderPlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'folder', space, parentId: node.folder.id }) },
                { label: t('rename'), icon: <Pencil className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'renameFolder', folder: node.folder }) },
                { label: t('deleteFolder'), icon: <Trash2 className="size-4" aria-hidden />, onSelect: () => void deleteFolder(node.folder), destructive: true },
              ]}
            />
          )}
        </div>
        {open && (
          <>
            {node.folders.map((child) => folder(space, child, depth + 1))}
            {node.documents.map((d) => documentLink(d, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const nested = (tree?.spaces ?? []).map((space) => nestSpace(space, query));
  const shown = searching ? nested.filter((n) => n.documents.length > 0 || n.folders.length > 0) : nested;

  return (
    <aside className="flex flex-col gap-3 border-b px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-80 md:shrink-0 md:border-r md:border-b-0 md:px-3">
      <div className="flex items-center gap-2 px-1">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
          <Link to={page}>{t('title')}</Link>
        </h1>
        {tree?.canCreateSpace && (
          <Button size="sm" variant="outline" onClick={() => setNaming({ kind: 'space' })}>
            <Plus className="size-4" aria-hidden />
            {t('newSpace')}
          </Button>
        )}
      </div>
      <Link
        to={`${page}/proposals`}
        aria-current={proposalsOpen ? 'page' : undefined}
        className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', proposalsOpen ? 'bg-accent font-medium' : 'hover:bg-accent/50')}
      >
        <GitPullRequestArrow className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('proposals.title')}</span>
        {pending > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label={t('proposals.waiting', { n: pending })}>
            {/* Amber, as a dot: proposals wait on this reader (docs/design.md, "Component rules"). */}
            <span className="size-1.5 rounded-full bg-signal" aria-hidden />
            {pending}
          </span>
        )}
      </Link>
      <div className="relative">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input className="pl-8" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('find')} aria-label={t('find')} />
      </div>
      <nav aria-label={t('title')} className="scrollbar-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {error ? <p className="px-2.5 text-sm text-destructive">{word(error)}</p> : null}
        {tree && tree.spaces.length === 0 && <p className="px-2.5 text-sm text-muted-foreground">{t(tree.canCreateSpace ? 'noSpacesAdmin' : 'noSpaces')}</p>}
        {searching && tree && shown.length === 0 && <p className="px-2.5 text-sm text-muted-foreground">{t('noMatch')}</p>}
        {shown.map((node) => (
          <section key={node.space.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 px-1">
              <h2 className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground">
                <span className="truncate">{node.space.name}</span>
                {node.space.reading === 'members' && <Lock className="size-3 shrink-0" aria-label={t('restricted')} />}
              </h2>
              {node.space.canEdit && (
                <ActionMenu
                  label={t('spaceActions', { name: node.space.name })}
                  items={[
                    { label: t('newDocument'), icon: <FilePlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'document', space: node.space, folderId: '' }) },
                    { label: t('newFolder'), icon: <FolderPlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'folder', space: node.space, parentId: '' }) },
                    { label: t('spaceSettings'), icon: <Settings className="size-4" aria-hidden />, onSelect: () => setSettings(node.space) },
                  ]}
                />
              )}
            </div>
            {node.folders.map((f) => folder(node.space, f, 0))}
            {node.documents.map((d) => documentLink(d, 0))}
            {!searching && node.folders.length === 0 && node.documents.length === 0 && (
              <p className="px-2 py-1 text-sm text-muted-foreground">{t(node.space.canEdit ? 'emptySpaceEditor' : 'emptySpace')}</p>
            )}
          </section>
        ))}
      </nav>
      {naming?.kind === 'space' && (
        <NameDialog
          title={t('newSpaceTitle')}
          description={t('newSpaceNote')}
          label={t('spaceName')}
          max={80}
          action={t('create')}
          onClose={() => setNaming(null)}
          submit={async (name) => {
            await api(`${base}/spaces`, { body: { name } });
            toast.success(t('spaceCreated', { name }));
            await reload();
          }}
        />
      )}
      {naming?.kind === 'folder' && (
        <NameDialog
          title={t('newFolderTitle', { space: naming.space.name })}
          label={t('folderName')}
          max={80}
          action={t('create')}
          onClose={() => setNaming(null)}
          submit={async (name) => {
            await api(`${base}/folders`, { body: { spaceId: naming.space.id, parentId: naming.parentId, name } });
            await reload();
          }}
        />
      )}
      {naming?.kind === 'renameFolder' && (
        <NameDialog
          title={t('renameFolderTitle')}
          label={t('folderName')}
          initial={naming.folder.name}
          max={80}
          action={t('rename')}
          onClose={() => setNaming(null)}
          submit={async (name) => {
            await api(`${base}/folders/${encodeURIComponent(naming.folder.id)}`, { method: 'PATCH', body: { name } });
            await reload();
          }}
        />
      )}
      {naming?.kind === 'document' && (
        <NameDialog
          title={t('newDocumentTitle', { space: naming.space.name })}
          description={t('newDocumentNote')}
          label={t('documentTitle')}
          max={120}
          action={t('create')}
          onClose={() => setNaming(null)}
          submit={async (title) => {
            const created = await api<Schemas['KnowledgeDocument']>(`${base}/documents`, {
              body: { spaceId: naming.space.id, folderId: naming.folderId, title, text: `# ${title}\n` },
            });
            await reload();
            // A new document opens ready to write in.
            void navigate(`${page}/${created.id}`, { state: { edit: true } });
          }}
        />
      )}
      {settings && (
        <SpaceSettingsDialog
          team={team}
          space={settings}
          onClose={() => setSettings(null)}
          onChanged={() => void reload()}
          onDeleted={() => {
            void reload();
            void navigate(page);
          }}
        />
      )}
    </aside>
  );
}
