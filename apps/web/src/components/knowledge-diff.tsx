/**
 * Two texts of a knowledge document, line by line (lib/knowledge-diff.ts
 * decides what changed): removed lines struck on a destructive tint, added
 * ones on a success tint, each numbered on its own side, and the unchanged
 * runs between changes folded into one line saying how many are hidden.
 */

import { useTranslations } from 'use-intl';

import { diffStats, diffText, foldDiff } from '@/lib/knowledge-diff';
import { cn } from '@/lib/utils';

export function KnowledgeDiff({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const t = useTranslations('team.knowledge.diff');
  const all = diffText(before, after);
  const rows = foldDiff(all);
  const stats = diffStats(all);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t('between', { before: beforeLabel, after: afterLabel })}</span>
        {rows.length > 0 && <span>{t('stats', stats)}</span>}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border font-mono text-xs leading-5">
          <table className="w-full border-collapse">
            <tbody>
              {rows.map((row, i) =>
                row.kind === 'gap' ? (
                  <tr key={i} className="bg-muted text-muted-foreground">
                    <td colSpan={4} className="px-3 py-1 font-sans">{t('hidden', { n: row.lines })}</td>
                  </tr>
                ) : (
                  <tr key={i} className={cn(row.kind === 'added' && 'bg-success/10', row.kind === 'removed' && 'bg-destructive/10')}>
                    <td className="w-10 px-2 text-right text-muted-foreground select-none">{row.before ?? ''}</td>
                    <td className="w-10 px-2 text-right text-muted-foreground select-none">{row.after ?? ''}</td>
                    <td className="w-5 text-center text-muted-foreground select-none" aria-hidden>
                      {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ''}
                    </td>
                    <td className={cn('pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]', row.kind === 'removed' && 'line-through decoration-muted-foreground/40')}>
                      <span className="sr-only">{row.kind === 'added' ? t('added') : row.kind === 'removed' ? t('removed') : ''}</span>
                      {row.text || ' '}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
