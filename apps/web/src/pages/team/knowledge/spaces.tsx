/**
 * Spaces on the knowledge page (docs/tech/knowledge.md, "The console"): the
 * overview Knowledge opens on, one card per space the reader reads, with who
 * reads it, what it holds and when it last changed; and a space's own page,
 * opened from the sidebar, with its documents most recently changed first.
 * The team's admin creates a space here or from the sidebar.
 */

import { BookText, FileText, Lock, Plus, Table2, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { folderPaths, type KnowledgeSpace, type KnowledgeTree } from '@/lib/knowledge-tree';

/** When anything in a space last changed, or null for an empty one. */
const lastChange = (space: KnowledgeSpace) => space.documents.reduce<string | null>((at, d) => (!at || d.updatedAt > at ? d.updatedAt : at), null);

function Reading({ space }: { space: KnowledgeSpace }) {
  const t = useTranslations('team.knowledge.overview');
  const Icon = space.reading === 'members' ? Lock : UsersRound;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {t(space.reading === 'members' ? 'readMembers' : 'readTeam')}
    </span>
  );
}

export function SpacesOverview({ team, tree, onNewSpace }: { team: { id: string }; tree: KnowledgeTree; onNewSpace: () => void }) {
  const t = useTranslations('team.knowledge');
  const format = useFormatter();
  const page = `/teams/${team.id}/knowledge`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{t('emptyTitle')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{t('emptyHow')}</p>
        </div>
        {tree.canCreateSpace && (
          <Button size="sm" onClick={onNewSpace}>
            <Plus className="size-4" aria-hidden />
            {t('newSpace')}
          </Button>
        )}
      </div>
      {tree.spaces.length === 0 ? (
        <div className="flex max-w-prose flex-col gap-3 rounded-lg border border-dashed px-5 py-6 text-sm text-muted-foreground">
          <BookText className="size-6" aria-hidden />
          <p>{t(tree.canCreateSpace ? 'noSpacesAdmin' : 'noSpaces')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tree.spaces.map((space) => {
            const at = lastChange(space);
            return (
              <li key={space.id}>
                <Link to={`${page}/spaces/${space.id}`} className="flex h-full flex-col gap-2 rounded-lg border px-4 py-3.5 transition-colors hover:bg-accent/50">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{space.name}</span>
                    <Reading space={space} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('overview.holds', { documents: space.documents.length, folders: space.folders.length })}
                    {at && ` · ${t('overview.changed', { when: format.relativeTime(new Date(at), new Date()) })}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="max-w-prose text-sm text-muted-foreground">{t('emptyAgents')}</p>
    </div>
  );
}

export function SpaceHome({ team, space }: { team: { id: string }; space: KnowledgeSpace }) {
  const t = useTranslations('team.knowledge');
  const format = useFormatter();
  const page = `/teams/${team.id}/knowledge`;
  const paths = new Map(folderPaths(space).map((f) => [f.id, f.path.join(' / ')]));
  const recent = [...space.documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{space.name}</h1>
          <span className="flex flex-wrap items-center gap-3">
            <Reading space={space} />
            <span className="text-xs text-muted-foreground">{t('overview.holds', { documents: space.documents.length, folders: space.folders.length })}</span>
          </span>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to={`${page}/table/${space.id}`}>
            <Table2 className="size-4" aria-hidden />
            {t('openTable')}
          </Link>
        </Button>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(space.canEdit ? 'emptySpaceEditor' : 'emptySpace')}</p>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t('overview.recent')}</h2>
          <ul className="flex flex-col divide-y rounded-lg border">
            {recent.map((d) => (
              <li key={d.id}>
                <Link to={`${page}/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {paths.get(d.folderId) && <span className="text-muted-foreground">{paths.get(d.folderId)} / </span>}
                    {d.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{format.relativeTime(new Date(d.updatedAt), new Date())}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
