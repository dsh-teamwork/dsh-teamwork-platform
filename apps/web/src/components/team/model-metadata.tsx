import { PROVIDER_CATALOG } from '@dsh-teamwork/shared';
import { RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { agreedValues, changedValues, exactMatches, referenceSource, suggestedRates, type ModelMetadata } from '@/lib/model-metadata';

type Values = Record<string, string | number | boolean | readonly string[] | undefined>;
type Lookup = { models: ModelMetadata[]; usdToCny?: string; exchangeDate?: string };
type Filled<T> = { reference: string; before: Partial<T>; after: Partial<T>; fx?: { rate: string; date: string } };
type Outcome<T> =
  | { kind: 'filled'; filled: Filled<T> }
  | { kind: 'unchanged' | 'noValues'; reference: string }
  | { kind: 'none' | 'many' | 'failed' | 'fxFailed' | 'undone' };

/**
 * One click fills the form from a public catalog and says where the values came
 * from, with an undo; nothing is saved until the form is. It fills only from
 * entries whose id is the model's own, from several only when they agree, and
 * leaves unknown values alone.
 * Models.dev is read under the provider the catalog knows the address by, or
 * across every provider for one it does not (the server's rule); OpenRouter for
 * OpenRouter. With `auto`, it fills once as it opens, as if clicked: a model
 * with no rate yet starts from its reference instead of an empty form.
 */
export function ModelMetadataLookup<T extends Values>({ teamId, provider, model, current, apply, pricing = false, auto = false, disabled = false }: {
  teamId: string; provider: string; model: string;
  current: T; apply: (values: Partial<T>) => void;
  pricing?: boolean; auto?: boolean; disabled?: boolean;
}) {
  const t = useTranslations('modelMetadata');
  const id = useId();
  const source = referenceSource(provider);
  const sourceName = source === 'openrouter' ? 'OpenRouter' : 'Models.dev';
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState(model);
  const [candidates, setCandidates] = useState<Lookup | null>(null);
  const generation = useRef(0);
  const label = (m: ModelMetadata) => `${m.provider} / ${m.id}`;

  async function lookup(text: string) {
    const request = ++generation.current;
    setBusy(true);
    try {
      const value = await api<Lookup>(`teams/${teamId}/model-metadata/lookup`, { body: { source, provider, query: text.trim(), pricing } });
      return request === generation.current ? value : null;
    } catch {
      if (request === generation.current) setOutcome({ kind: 'failed' });
      return null;
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }

  // Prices are converted at the lookup's own exchange rate; without one, none are filled.
  function valuesOf(reference: ModelMetadata, found: Lookup): Values | null {
    if (pricing) return found.usdToCny ? suggestedRates(reference.prices, found.usdToCny) : null;
    return { contextWindow: reference.contextWindow, maxTokens: reference.maxTokens, vision: reference.vision, reasoningEfforts: reference.provider === provider && reference.id.toLowerCase() === model.trim().toLowerCase() ? reference.reasoningEfforts : undefined };
  }

  function fill(next: Values | null, reference: string, found: Lookup) {
    if (!next) return setOutcome({ kind: 'fxFailed' });
    if (Object.values(next).every((v) => v === undefined)) return setOutcome({ kind: 'noValues', reference });
    const after = changedValues<Values>(current, next) as Partial<T>;
    if (Object.keys(after).length === 0) return setOutcome({ kind: 'unchanged', reference });
    const before = Object.fromEntries(Object.keys(after).map((key) => [key, current[key]])) as Partial<T>;
    apply(after);
    setPicking(false);
    setOutcome({ kind: 'filled', filled: { reference, before, after, fx: pricing ? { rate: found.usdToCny!.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''), date: found.exchangeDate ?? '' } : undefined } });
  }

  async function refresh() {
    setOutcome(null);
    const found = await lookup(model);
    if (!found) return;
    const exact = exactMatches(found.models, model);
    const values = exact.map((m) => valuesOf(m, found));
    if (exact.length > 0 && values.includes(null)) return setOutcome({ kind: 'fxFailed' });
    const agreed = agreedValues(values as Values[]);
    if (agreed) return fill(agreed, exact.length === 1 ? label(exact[0]) : t('agreeing', { count: exact.length, model: exact[0].id }), found);
    setOutcome({ kind: exact.length === 0 ? 'none' : 'many' });
    setCandidates(found);
    setQuery(model);
  }

  async function search() {
    setCandidates(null);
    const found = await lookup(query);
    if (found) setCandidates(found);
  }

  // Once per opened form; refresh is recreated each render.
  const filled = useRef(false);
  useEffect(() => {
    if (!auto || filled.current || !model.trim()) return;
    filled.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, model]);

  const display = (value: unknown) => value === undefined || value === '' ? t('unknown') : Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? t(value ? 'yes' : 'no') : String(value);
  // Undo is offered only while the fields still hold what was filled: it never overwrites a later hand edit.
  const undoable = outcome?.kind === 'filled' && Object.entries(outcome.filled.after).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
  // A provider named after no catalog entry is searched on Models.dev by exact id alone (modelmeta.Search), which an
  // admin cannot see; say so where a search came back empty.
  const unlisted = source === 'models_dev' && !PROVIDER_CATALOG.some((p) => p.id === provider);
  const offerPicker = outcome && (outcome.kind === 'none' || outcome.kind === 'many' || outcome.kind === 'noValues');

  return <div className="flex flex-col gap-2 text-sm">
    <div>
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy || !model.trim()} onClick={() => void refresh()}>
        <RefreshCw className={busy ? 'animate-spin' : undefined} aria-hidden />
        {t(busy ? 'loading' : pricing ? 'refreshPrices' : 'refresh')}
      </Button>
    </div>
    {outcome && <div role="status" className="rounded-md bg-muted p-3 text-muted-foreground">
      {outcome.kind === 'filled' && <>
        <p>{t('filled', { source: sourceName, reference: outcome.filled.reference })}</p>
        <ul className="mt-1">{Object.keys(outcome.filled.after).map((key) => <li key={key}>{t(key)}: {display(outcome.filled.before[key])} → <span className="text-foreground">{display(outcome.filled.after[key])}</span></li>)}</ul>
        {outcome.filled.fx && <p className="mt-1">{t('converted', { rate: outcome.filled.fx.rate, date: outcome.filled.fx.date })}</p>}
        {undoable && <Button type="button" variant="link" size="sm" className="h-auto px-0 underline" disabled={disabled} onClick={() => { apply(outcome.filled.before); setOutcome({ kind: 'undone' }); }}>{t('undo')}</Button>}
      </>}
      {(outcome.kind === 'unchanged' || outcome.kind === 'noValues') && <p>{t(outcome.kind, { source: sourceName, reference: outcome.reference })}</p>}
      {(outcome.kind === 'none' || outcome.kind === 'many') && <p>{t(outcome.kind, { source: sourceName, model })}</p>}
      {outcome.kind === 'none' && unlisted && <p>{t('unlistedProvider', { provider })}</p>}
      {outcome.kind === 'failed' && <p className="text-destructive">{t('failed')}</p>}
      {outcome.kind === 'fxFailed' && <p>{t('fxFailed')}</p>}
      {outcome.kind === 'undone' && <p>{t('undone')}</p>}
      {offerPicker && !picking && <Button type="button" variant="link" size="sm" className="h-auto px-0 underline" disabled={disabled} onClick={() => setPicking(true)}>{t('choose')}</Button>}
    </div>}
    {picking && <div className="flex flex-col gap-2 rounded-md border p-3">
      <Field id={`${id}-query`} label={t('query')} hint={source === 'models_dev' ? t('queryHint') : undefined}>
        <div className="flex gap-2">
          <Input id={`${id}-query`} value={query} maxLength={200} disabled={disabled} onChange={(e) => { setQuery(e.target.value); setCandidates(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
          <Button type="button" variant="outline" disabled={disabled || busy || !query.trim()} onClick={() => void search()}>{t('lookup')}</Button>
        </div>
      </Field>
      {candidates?.models.length === 0 && <p>{t('empty')}</p>}
      {candidates?.models.length === 0 && unlisted && <p>{t('unlistedProvider', { provider })}</p>}
      {!!candidates?.models.length && <Select label={t('candidate')} value="" disabled={disabled} change={(value) => { const m = candidates.models.find((c) => label(c) === value); if (m) fill(valuesOf(m, candidates), label(m), candidates); }} options={candidates.models.map((m) => ({ value: label(m), label: m.name && m.name !== m.id ? `${label(m)} · ${m.name}` : label(m) }))} />}
      {candidates?.models.length === 50 && <p className="text-muted-foreground">{t('narrow')}</p>}
    </div>}
  </div>;
}
