import type { Schemas } from './api';

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
