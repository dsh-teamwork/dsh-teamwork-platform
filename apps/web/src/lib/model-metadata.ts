import { api, type Schemas } from './api';

export type ModelMetadata = Schemas['ModelMetadata'];
export type Rates = Partial<Pick<Schemas['ModelRateInput'], 'input' | 'output' | 'cacheRead' | 'cacheWrite'>>;

// Rates are CNY/million tokens with six decimal places. Round up using exact
// decimal arithmetic; round positive suggestions up to two significant digits
// (at least one point/million tokens). A missing rate never becomes free.
export function suggestedRates(prices: ModelMetadata['prices'], fx: string): Rates | null {
  const decimal = (value: string) => {
    if (!/^\d{1,10}(?:\.\d{1,12})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
  };
  const exchange = decimal(fx);
  if (!exchange || exchange.n <= 0n) return null;
  const result: Rates = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    const price = prices[key] === undefined ? null : decimal(prices[key]);
    if (!price) continue;
    const denominator = price.d * exchange.d;
    let units = (price.n * exchange.n * 1_000_000n + denominator - 1n) / denominator;
    if (units > 1_000_000_000_000_000n) return null;
    if (units > 0n) {
      const step = 10n ** BigInt(Math.max(3, String(units).length - 2));
      units = ((units + step - 1n) / step) * step;
    }
    result[key] = `${units / 1_000_000n}.${String(units % 1_000_000n).padStart(6, '0')}`.replace(/\.?0+$/, '');
  }
  return result;
}

/** The candidates whose id is the model's own, ignoring case: the only ones a refresh may fill from. */
export function exactMatches(models: ModelMetadata[], model: string): ModelMetadata[] {
  const id = model.trim().toLowerCase();
  return models.filter((m) => m.id.toLowerCase() === id);
}

/**
 * The values to fill when every exact match says the same (the same id at
 * several providers usually does), or null when they disagree or there are
 * none: then the admin chooses.
 */
export function agreedValues<V extends Record<string, unknown>>(values: V[]): V | null {
  const key = (v: V) => JSON.stringify(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  return values.length > 0 && values.every((v) => key(v) === key(values[0])) ? values[0] : null;
}

/** The values a reference would change, keyed as the form keys them; an unknown value is never a change. */
export function changedValues<T extends Record<string, string | number | boolean | undefined>>(current: T, next: Partial<T>): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== undefined && next[key] !== current[key]) changed[key] = next[key];
  }
  return changed;
}

/** Where a model's public reference comes from: OpenRouter for OpenRouter, Models.dev for every other provider. */
export const referenceSource = (provider: string) => (provider === 'openrouter' ? 'openrouter' : 'models_dev');

/** A model's limits and rates as its public reference states them, when its exact matches agree. */
export interface Reference {
  /** The entry the values came from, as `provider / id`, or the id when several agreeing providers list it. */
  from: string;
  details: { contextWindow?: number; maxTokens?: number; vision?: boolean };
  /** Every rate a reference rate needs, or null when the reference states no input or output price or the exchange rate is unavailable. */
  rates: Required<Rates> | null;
}

/**
 * The rates to save from suggested ones: an input and an output price are
 * required, and a missing cache rate is charged as uncached input, so a call
 * is never cheaper than its supplier could bill it.
 */
export function completeRates(rates: Rates | null): Required<Rates> | null {
  if (!rates?.input || !rates.output) return null;
  return { input: rates.input, output: rates.output, cacheRead: rates.cacheRead ?? rates.input, cacheWrite: rates.cacheWrite ?? rates.input };
}

/**
 * The reference for a model, read without asking the admin: only from entries
 * whose id is the model's own, and only when they all agree; null when there is
 * none, or the catalog cannot be read. The admin can still choose another
 * reference in the model's dialogs.
 */
export function referenceFrom(models: ModelMetadata[], model: string, usdToCny: string | undefined): Reference | null {
  const exact = exactMatches(models, model);
  const details = agreedValues(exact.map((m) => ({ contextWindow: m.contextWindow, maxTokens: m.maxTokens, vision: m.vision })));
  const prices = agreedValues(exact.map((m) => m.prices));
  if (!details && !prices) return null;
  return {
    from: exact.length === 1 ? `${exact[0].provider} / ${exact[0].id}` : exact[0].id,
    details: details ?? {},
    rates: prices && usdToCny ? completeRates(suggestedRates(prices, usdToCny)) : null,
  };
}

export async function lookupReference(teamId: string, provider: string, model: string): Promise<Reference | null> {
  try {
    const found = await api<{ models: ModelMetadata[]; usdToCny?: string }>(`teams/${teamId}/model-metadata/lookup`, {
      body: { source: referenceSource(provider), provider, query: model.trim(), pricing: true },
    });
    return referenceFrom(found.models, model, found.usdToCny);
  } catch {
    return null;
  }
}
