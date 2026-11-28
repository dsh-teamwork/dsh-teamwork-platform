/**
 * The knowledge page's first column: the space open in the sidebar, or every
 * space the reader reads, each with its folders nested and its documents,
 * found by title; the proposals waiting on the reader; and, for an editor,
 * making and naming what is in a space, a new document from a template when a
 * space has a templates folder. Spaces themselves are listed and made from the
 * sidebar and the overview (./index.tsx).
 * The find box filters the tree by title and, a moment after typing stops,
 * lists the documents whose text holds the words; Mentions lists those that
 * name the reader; any folder opens as a table of its documents' properties.
 */

import { AtSign, ChevronRight, FilePlus, FileText, Folder, FolderPlus, GitPullRequestArrow, Lock, Pencil, Search, Settings, Table2, TextSearch, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useTeamError } from '@/components/team/use-mutation';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, type Schemas, type Team } from '@/lib/api';
import { fillTemplate, headingSlug, readableLine } from '@dsh-teamwork/shared/knowledge-format';
import { nestSpace, type FolderNode, type KnowledgeDocumentSummary, type KnowledgeSpace, type KnowledgeTree } from '@dsh-teamwork/shared/knowledge-tree';
import { cn } from '@/lib/utils';

import { ActionMenu, NameDialog } from './shared';
import { SpaceSettingsDialog } from './space-settings';

/** What a name dialog is open for. */
type Naming =
  | { kind: 'folder'; space: KnowledgeSpace; parentId: string }
  | { kind: 'document'; space: KnowledgeSpace; folderId: string }
  | { kind: 'renameFolder'; folder: Schemas['KnowledgeFolder'] };

export function KnowledgeTreePanel({ team, tree, error, reload, spaceId, openId, open, pending }: {
  team: Team;
  tree?: KnowledgeTree;
  error?: unknown;
  reload: () => Promise<unknown>;
  /** The space open in the sidebar, whose contents alone the tree shows; empty for every space. */
  spaceId: string;
  /** The open document. */
  openId: string;
  /** Which of the lists above the tree is open, if one is. */
  open: 'proposals' | 'mentions' | '';
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
  // What the tree already shows by its title is not listed again.
  const found = useTextSearch(base, query)?.filter((f) => !f.titleMatch) ?? null;

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
          <ActionMenu
            label={t('folderActions', { name: node.folder.name })}
            items={[
              { label: t('openTable'), icon: <Table2 className="size-4" aria-hidden />, onSelect: () => void navigate(`${page}/table/${space.id}/${node.folder.id}`) },
              ...(space.canEdit
                ? [
                    { label: t('newDocument'), icon: <FilePlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'document', space, folderId: node.folder.id }) },
                    { label: t('newFolder'), icon: <FolderPlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'folder', space, parentId: node.folder.id }) },
                    { label: t('rename'), icon: <Pencil className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'renameFolder', folder: node.folder }) },
                    { label: t('deleteFolder'), icon: <Trash2 className="size-4" aria-hidden />, onSelect: () => void deleteFolder(node.folder), destructive: true },
                  ]
                : []),
            ]}
          />
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
  // One space while one is open; every space while finding, so a title in another space is found too.
  const shown = searching ? nested.filter((n) => n.documents.length > 0 || n.folders.length > 0) : spaceId ? nested.filter((n) => n.space.id === spaceId) : nested;

  return (
    <aside className="flex flex-col gap-3 border-b px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-80 md:shrink-0 md:border-r md:border-b-0 md:px-3">
      <div className="flex items-center gap-2 px-1">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
          <Link to={page}>{t('title')}</Link>
        </h1>
      </div>
      <Link
        to={`${page}/proposals`}
        aria-current={open === 'proposals' ? 'page' : undefined}
        className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', open === 'proposals' ? 'bg-accent font-medium' : 'hover:bg-accent/50')}
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
      <Link
        to={`${page}/mentions`}
        aria-current={open === 'mentions' ? 'page' : undefined}
        className={cn('-mt-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', open === 'mentions' ? 'bg-accent font-medium' : 'hover:bg-accent/50')}
      >
        <AtSign className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('mentions.title')}</span>
      </Link>
      <div className="relative">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input className="pl-8" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('find')} aria-label={t('find')} />
      </div>
      <nav aria-label={t('title')} className="scrollbar-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {error ? <p className="px-2.5 text-sm text-destructive">{word(error)}</p> : null}
        {tree && tree.spaces.length === 0 && <p className="px-2.5 text-sm text-muted-foreground">{t(tree.canCreateSpace ? 'noSpacesAdmin' : 'noSpaces')}</p>}
        {searching && tree && shown.length === 0 && (found?.length ?? 0) === 0 && <p className="px-2.5 text-sm text-muted-foreground">{t('noMatch')}</p>}
        {shown.map((node) => (
          <section key={node.space.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 px-1">
              <h2 className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground">
                <span className="truncate">{node.space.name}</span>
                {node.space.reading === 'members' && <Lock className="size-3 shrink-0" aria-label={t('restricted')} />}
              </h2>
              <ActionMenu
                label={t('spaceActions', { name: node.space.name })}
                items={[
                  { label: t('openTable'), icon: <Table2 className="size-4" aria-hidden />, onSelect: () => void navigate(`${page}/table/${node.space.id}`) },
                  ...(node.space.canEdit
                    ? [
                        { label: t('newDocument'), icon: <FilePlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'document', space: node.space, folderId: '' }) },
                        { label: t('newFolder'), icon: <FolderPlus className="size-4" aria-hidden />, onSelect: () => setNaming({ kind: 'folder', space: node.space, parentId: '' }) },
                        { label: t('spaceSettings'), icon: <Settings className="size-4" aria-hidden />, onSelect: () => setSettings(node.space) },
                      ]
                    : []),
                ]}
              />
            </div>
            {node.folders.map((f) => folder(node.space, f, 0))}
            {node.documents.map((d) => documentLink(d, 0))}
            {!searching && node.folders.length === 0 && node.documents.length === 0 && (
              <p className="px-2 py-1 text-sm text-muted-foreground">{t(node.space.canEdit ? 'emptySpaceEditor' : 'emptySpace')}</p>
            )}
          </section>
        ))}
        {searching && found && found.length > 0 && (
          <section className="flex flex-col gap-0.5" aria-label={t('inText')}>
            <h2 className="flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-muted-foreground">
              <TextSearch className="size-3.5" aria-hidden />
              {t('inText')}
            </h2>
            {found.map((f) => (
              <Link
                key={f.id}
                to={`${page}/${f.id}${f.heading ? `#${encodeURIComponent(headingSlug(f.heading))}` : ''}`}
                className={cn('flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm', f.id === openId ? 'bg-accent' : 'hover:bg-accent/50')}
              >
                <span className="truncate font-medium">{f.title}</span>
                {f.snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{readableLine(f.snippet, (id) => team.members.find((m) => m.userId === id)?.email ?? null)}</span>}
              </Link>
            ))}
          </section>
        )}
      </nav>
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
        <NewDocumentDialog
          spaces={tree?.spaces ?? []}
          space={naming.space}
          onClose={() => setNaming(null)}
          submit={async (title, template) => {
            const text = template ? fillTemplate((await api<Schemas['KnowledgeDocument']>(`${base}/documents/${encodeURIComponent(template)}`)).text, title, new Date()) : `# ${title}\n`;
            const created = await api<Schemas['KnowledgeDocument']>(`${base}/documents`, {
              body: { spaceId: naming.space.id, folderId: naming.folderId, title, text },
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

/**
 * Names a new document, and, when any space the reader sees has a templates
 * folder, which of its documents to start from: the new space's own first,
 * then the others', by space.
 */
function NewDocumentDialog({ spaces, space, submit, onClose }: {
  spaces: KnowledgeSpace[];
  space: KnowledgeSpace;
  submit: (title: string, template: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslations('team.knowledge');
  const [template, setTemplate] = useState('');
  const templates = [space, ...spaces.filter((s) => s.id !== space.id)]
    .filter((s) => s.templatesFolderId)
    .flatMap((s) => s.documents.filter((d) => d.folderId === s.templatesFolderId).map((d) => ({ value: d.id, label: s.id === space.id ? d.title : `${s.name} / ${d.title}` })));
  return (
    <NameDialog
      title={t('newDocumentTitle', { space: space.name })}
      description={t('newDocumentNote')}
      label={t('documentTitle')}
      max={120}
      action={t('create')}
      onClose={onClose}
      submit={(title) => submit(title, template)}
    >
      {templates.length > 0 && (
        <Field id="knowledge-template" label={t('template')} hint={t('templateHint')}>
          <Select id="knowledge-template" label={t('template')} value={template} options={[{ value: '', label: t('blank') }, ...templates]} change={setTemplate} className="w-full" />
        </Field>
      )}
    </NameDialog>
  );
}

/**
 * The documents whose text holds the query, asked a moment after typing
 * stops, or null while there is no answer for the query as it is.
 */
function useTextSearch(base: string, query: string): Schemas['KnowledgeFound'][] | null {
  const q = query.trim();
  const [found, setFound] = useState<{ q: string; results: Schemas['KnowledgeFound'][] } | null>(null);
  useEffect(() => {
    if (!q) return;
    let live = true;
    const timer = setTimeout(() => {
      api<{ results: Schemas['KnowledgeFound'][] }>(`${base}/search?q=${encodeURIComponent(q)}`).then(
        (r) => live && setFound({ q, results: r.results }),
        () => live && setFound({ q, results: [] }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [base, q]);
  return found && found.q === q ? found.results : null;
}
