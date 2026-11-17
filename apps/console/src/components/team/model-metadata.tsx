import { useId, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { suggestedRates, type ModelMetadata } from '@/lib/model-metadata';

/** Live suggestions only: selecting a reference never changes the call ID. */
export function ModelMetadataLookup({ teamId, provider, model, current, apply, pricing = false, disabled = false }: {
  teamId: string; provider: string; model: string;
  current: Record<string, string | number | boolean | undefined>;
  apply: (value: ModelMetadata | NonNullable<ReturnType<typeof suggestedRates>>) => void;
  pricing?: boolean; disabled?: boolean;
}) {
  const t = useTranslations('modelMetadata');
  const id = useId();
  const [source, setSource] = useState(provider === 'openrouter' ? 'openrouter' : 'models_dev');
  const [referenceProvider, setReferenceProvider] = useState(provider);
  const [query, setQuery] = useState(model);
  const [models, setModels] = useState<ModelMetadata[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [fx, setFx] = useState('');
  const [exchangeDate, setExchangeDate] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const generation = useRef(0);
  function invalidate() { generation.current++; setModels(null); setSelected(''); setError(false); setBusy(false); setFx(''); setExchangeDate(''); }
  async function lookup() {
    const request = ++generation.current;
    setBusy(true); setError(false); setModels(null); setSelected(''); setFx(''); setExchangeDate('');
    try {
      const value = await api<{ models: ModelMetadata[]; usdToCny?: string; exchangeDate?: string }>(`teams/${teamId}/model-metadata/lookup`, { body: { source, provider: referenceProvider.trim(), query: query.trim(), pricing } });
      if (request === generation.current) { setModels(value.models); setFx(value.usdToCny ?? ''); setExchangeDate(value.exchangeDate ?? ''); }
    } catch { if (request === generation.current) setError(true); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const candidate = models?.find((m) => m.id === selected);
  const rates = candidate ? suggestedRates(candidate.prices, fx, multiplier) : null;
  const preview = candidate ? pricing ? rates ?? {} : { contextWindow: candidate.contextWindow, maxTokens: candidate.maxTokens, vision: candidate.vision } : {};
  const keys = Object.keys(preview).filter((key) => preview[key as keyof typeof preview] !== undefined);
  const display = (value: unknown): string => value === undefined || value === '' ? t('unknown') : typeof value === 'boolean' ? t(value ? 'yes' : 'no') : String(value);
  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">{t(pricing ? 'pricingTitle' : 'title')}</summary>
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-muted-foreground">{t('hint')}</p>
      <Select label={t('source')} value={source} options={[{ value: 'models_dev', label: 'Models.dev' }, { value: 'openrouter', label: 'OpenRouter' }]} disabled={disabled} change={(v) => { invalidate(); setSource(v); }} />
      {source === 'models_dev' && <Field id={`${id}-provider`} label={t('provider')} hint={t('providerHint')}>
        <Input id={`${id}-provider`} value={referenceProvider} maxLength={100} disabled={disabled} onChange={(e) => { invalidate(); setReferenceProvider(e.target.value); }} />
      </Field>}
      <Field id={`${id}-query`} label={t('query')}>
        <Input id={`${id}-query`} value={query} maxLength={200} disabled={disabled} onChange={(e) => { invalidate(); setQuery(e.target.value); }} />
      </Field>
      <Button type="button" variant="outline" disabled={disabled || busy || !query.trim() || (source === 'models_dev' && !referenceProvider.trim())} onClick={() => void lookup()}>{t(busy ? 'loading' : 'lookup')}</Button>
      {error && <p role="alert" className="text-destructive">{t('failed')}</p>}
      {models?.length === 0 && <p role="status">{t('empty')}</p>}
      {!!models?.length && <Select label={t('candidate')} value={selected} disabled={disabled} change={setSelected} options={models.map((m) => ({ value: m.id, label: `${m.name || m.id} · ${m.id}` }))} />}
      {models?.length === 50 && <p className="text-muted-foreground">{t('narrow')}</p>}
      {candidate && <>
        <p className="text-muted-foreground">{source === 'models_dev' ? 'Models.dev' : 'OpenRouter'} · {candidate.provider} / {candidate.id}</p>
        {candidate.outputModalities && <p>{t('outputTypes')}: {candidate.outputModalities.join(', ')}</p>}
        {pricing && <>
          <p className="text-muted-foreground">{t('priceHint')}</p>
          <dl className="grid grid-cols-2 gap-1">{(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => <div key={key}><dt>{t(key)}</dt><dd>{suggestedRates(candidate.prices, fx, '1')?.[key] ?? t('unknown')}</dd></div>)}</dl>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-multiplier`} label={t('multiplier')}><Input id={`${id}-multiplier`} inputMode="decimal" value={multiplier} disabled={disabled} onChange={(e) => setMultiplier(e.target.value)} /></Field>
          </div>
          {exchangeDate && <p className="text-muted-foreground">{t('fxAutomatic', { date: exchangeDate })}</p>}
          {!fx && <p role="status" className="text-muted-foreground">{t('fxFailed')}</p>}
          {!!fx && !rates && <p className="text-muted-foreground">{t('conversionHint')}</p>}
        </>}
        <dl>{keys.map((key) => <div key={key} className="flex justify-between gap-3"><dt>{t(key)}</dt><dd>{display(current[key])} → {display(preview[key as keyof typeof preview])}</dd></div>)}</dl>
        <p className="text-muted-foreground">{t('applyHint')}</p>
        <Button type="button" variant="outline" disabled={disabled || keys.length === 0} onClick={() => { if (pricing) { if (rates) apply(rates); } else apply(candidate); }}>{t('apply')}</Button>
      </>}
    </div>
  </details>;
}
