/**
 * Pages (`/teams/{teamId}/pages[/{pageId}][?list=shared|all]`, docs/tech/pages.md, "The clients"): what agents
 * published, in Workspace for everyone. The second column lists the reader's own, those shared with them by name or
 * with the team, or, for the team's admin, every page of the team (without its content unless they may read it); the
 * third shows the one open, its versions below it.
 */

import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { KIND_ICON, PageViewer, personName, SharingBadge } from '@/components/page-viewer';
import type { Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';

type List = Schemas['PageList'];

export function TeamPagesPage() {
  const { team } = useTeam();
  const { pageId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const t = useTranslations('team.pages');
  const format = useFormatter();
  const lists = team.role === 'admin' ? (['mine', 'shared', 'all'] as const) : (['mine', 'shared'] as const);
  const list = lists.find((l) => l === params.get('list')) ?? 'mine';
  const suffix = list === 'mine' ? '' : `?list=${list}`;
  const base = `/teams/${team.id}/pages`;
  const { data, error, reload } = useApi<List>(`teams/${encodeURIComponent(team.id)}/pages?list=${list}`);
  const open = pageId || data?.pages[0]?.id || '';

  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-3 border-b px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-80 md:shrink-0 md:border-r md:border-b-0 md:px-3">
        <h1 className="px-1 text-lg font-semibold tracking-tight">{t('title')}</h1>
        <div role="tablist" aria-label={t('title')} className="grid gap-1 rounded-lg bg-muted p-1 text-sm" style={{ gridTemplateColumns: `repeat(${lists.length}, minmax(0, 1fr))` }}>
          {lists.map((l) => (
            <Link
              key={l}
              role="tab"
              aria-selected={l === list}
              to={l === 'mine' ? base : `${base}?list=${l}`}
              className={cn('truncate rounded-md px-2 py-1.5 text-center', l === list ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}
            >
              {t(`lists.${l}`)}
            </Link>
          ))}
        </div>
        <nav aria-label={t('title')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto text-sm">
          {error ? <p className="px-2.5 text-destructive">{t('loadFailed')}</p> : null}
          {data?.pages.length === 0 && <p className="px-2.5 text-muted-foreground">{t(`empty.${list}`)}</p>}
          {data?.pages.map((p) => {
            const Icon = KIND_ICON[p.kind];
            return (
              <Link
                key={p.id}
                to={`${base}/${p.id}${suffix}`}
                aria-current={p.id === open ? 'page' : undefined}
                className={cn('flex gap-2.5 rounded-md px-2.5 py-2', p.id === open ? 'bg-accent' : 'hover:bg-accent/50')}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {p.via ? (
                      <span className="rounded-md border px-1.5 py-0.5">{t(`via.${p.via}`, { name: personName(p.owner) })}</span>
                    ) : (
                      <SharingBadge sharing={p.sharing} />
                    )}
                    <span>v{p.currentVersion} · {personName(p.updatedBy)} · {format.relativeTime(new Date(p.updatedAt), new Date())}</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-6 pb-8 md:px-8 md:pt-8">
        {open ? (
          <PageViewer
            key={open}
            teamId={team.id}
            pageId={open}
            versions
            onChanged={(deleted) => {
              void reload();
              if (deleted) void navigate(`${base}${suffix}`);
            }}
          />
        ) : data ? (
          <div className="flex max-w-prose flex-col gap-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('emptyTitle')}</p>
            <p>{t('emptyHow')}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
