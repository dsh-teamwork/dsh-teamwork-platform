/**
 * A resource's change, field by field (lib/config-diff.ts decides what
 * changed): a row per field, the old value struck and the new one beside it,
 * long text as two blocks. The raw JSON of both sides stays one click away.
 */

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { diffResource, type ResourceFields } from '@/lib/config-diff';
import { cn } from '@/lib/utils';

export function ConfigDiff({
  before,
  after,
  names,
  beforeLabel,
  afterLabel,
}: {
  /** Null when the resource does not exist yet: every field is new. */
  before: ResourceFields | null;
  after: ResourceFields;
  /** Team resource ids to names, so a model or plugin reads as itself. */
  names: ReadonlyMap<string, string>;
  beforeLabel: string;
  afterLabel: string;
}) {
  const t = useTranslations('team.diff');
  const changes = diffResource(before, after, names);
  const label = (key: string) => (t.has(`fields.${key}`) ? t(`fields.${key}`) : key);
  // A yes/no field reads as a word in the reader's language.
  const say = (value: string) => (value === 'true' ? t('yes') : value === 'false' ? t('no') : value);
  const empty = <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-col gap-3">
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <dl className="overflow-hidden rounded-lg border text-sm">
          <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 border-b bg-muted px-4 py-2 text-xs text-muted-foreground sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span>{t('field')}</span>
            <span className="hidden sm:block">{beforeLabel}</span>
            <span className="hidden sm:block">{afterLabel}</span>
          </div>
          {changes.map((c) => (
            <div key={c.key} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 border-t px-4 py-2.5 first-of-type:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{label(c.key)}</dt>
              {c.long ? (
                <>
                  <dd className="min-w-0 sm:col-start-2">
                    <pre className={cn('max-h-56 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]', c.before && 'line-through decoration-muted-foreground/40')}>{c.before || '—'}</pre>
                  </dd>
                  <dd className="col-start-2 min-w-0 sm:col-start-3">
                    <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{c.after || '—'}</pre>
                  </dd>
                </>
              ) : (
                <>
                  <dd className="min-w-0 text-muted-foreground line-through decoration-muted-foreground/40 [overflow-wrap:anywhere] sm:col-start-2">{say(c.before) || empty}</dd>
                  <dd className="col-start-2 flex min-w-0 items-start gap-1.5 font-medium [overflow-wrap:anywhere] sm:col-start-3">
                    <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
                    {say(c.after) || empty}
                  </dd>
                </>
              )}
            </div>
          ))}
        </dl>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('raw')}</summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {[
            [beforeLabel, before],
            [afterLabel, after],
          ].map(([title, value]) => (
            <div key={String(title)} className="min-w-0">
              <p className="mb-1 text-muted-foreground">{String(title)}</p>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(value, null, 2)}</pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
