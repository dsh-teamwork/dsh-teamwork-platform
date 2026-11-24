/**
 * A document's history (docs/tech/knowledge.md, "Rules"): every version with
 * its number, author, where it came from and its note; any one opened
 * read-only, compared with the one before it as a line difference, or, by an
 * editor, restored as a new version.
 */

import { Bot, GitCompare, RotateCcw } from 'lucide-react';
import { useFormatter, useTranslations } from 'use-intl';

import { KnowledgeDiff } from '@/components/knowledge-diff';
import { Button } from '@/components/ui/button';
import type { Schemas } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { personName, useNote } from './shared';

type Doc = Schemas['KnowledgeDocument'];

/** Where a version or a proposal came from: an agent's session is marked, the console is the default and is not. */
export function SourceBadge({ source, computer }: { source: 'console' | 'agent'; computer?: string }) {
  const t = useTranslations('team.knowledge');
  if (source !== 'agent') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
      <Bot className="size-3" aria-hidden />
      {computer ? t('agentOn', { computer }) : t('agent')}
    </span>
  );
}

export function HistoryList({ doc, onView, onCompare, onRestore, busy }: {
  doc: Doc;
  onView: (n: number) => void;
  onCompare: (n: number) => void;
  onRestore: (n: number) => void;
  busy: boolean;
}) {
  const t = useTranslations('team.knowledge.history');
  const format = useFormatter();
  const note = useNote();
  const versions = [...doc.versions].sort((a, b) => b.number - a.number);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <ul className="divide-y rounded-lg border text-sm">
        {versions.map((v) => (
          <li key={v.number} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <button type="button" onClick={() => onView(v.number)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
              <span className="w-9 shrink-0 font-medium tabular-nums">v{v.number}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span>{personName(v.author)}</span>
                  <SourceBadge source={v.source} computer={v.computer} />
                  {v.number === doc.currentVersion && <span className="text-xs text-muted-foreground">{t('current')}</span>}
                </span>
                <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {[format.dateTime(new Date(v.createdAt), { dateStyle: 'medium', timeStyle: 'short' }), note(v.note)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
            <div className="flex items-center gap-1">
              {v.number > 1 && (
                <Button size="sm" variant="ghost" onClick={() => onCompare(v.number)}>
                  <GitCompare className="size-4" aria-hidden />
                  {t('compare')}
                </Button>
              )}
              {doc.canEdit && v.number !== doc.currentVersion && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRestore(v.number)}>
                  <RotateCcw className="size-4" aria-hidden />
                  {t('restore')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Version `n` against the one before it. */
export function CompareView({ path, n }: { path: string; n: number }) {
  const t = useTranslations('team.knowledge.history');
  const after = useApi<Doc>(`${path}?version=${n}`);
  const before = useApi<Doc>(n > 1 ? `${path}?version=${n - 1}` : null);
  if (after.error || before.error) return <p role="alert" className="text-sm text-destructive">{t('loadFailed')}</p>;
  if (!after.data || (n > 1 && !before.data)) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('compareTitle', { n })}</h2>
      <KnowledgeDiff before={before.data?.text ?? ''} after={after.data.text} beforeLabel={t('versionN', { n: n - 1 })} afterLabel={t('versionN', { n })} />
    </section>
  );
}
