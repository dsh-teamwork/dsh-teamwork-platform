import type { Schemas } from './api';

export type ModelMetadata = Schemas['ModelMetadata'];

// Rates are CNY/million tokens with six decimal places. Round up using exact
// decimal arithmetic; round positive suggestions up to two significant digits
// (at least one point/million tokens). A missing rate never becomes free.
export function suggestedRates(prices: ModelMetadata['prices'], fx: string, multiplier: string): Partial<Pick<Schemas['ModelRateInput'], 'input' | 'output' | 'cacheRead' | 'cacheWrite'>> | null {
  const decimal = (value: string) => {
    if (!/^\d{1,10}(?:\.\d{1,12})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
  };
  const exchange = decimal(fx), factor = decimal(multiplier);
  if (!exchange || exchange.n <= 0n || !factor || factor.n <= 0n) return null;
  const result: NonNullable<ReturnType<typeof suggestedRates>> = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    const price = prices[key] === undefined ? null : decimal(prices[key]);
    if (!price) continue;
    const denominator = price.d * exchange.d * factor.d;
    let units = (price.n * exchange.n * factor.n * 1_000_000n + denominator - 1n) / denominator;
    if (units > 1_000_000_000_000_000n) return null;
    if (units > 0n) {
      const step = 10n ** BigInt(Math.max(3, String(units).length - 2));
      units = ((units + step - 1n) / step) * step;
    }
    result[key] = `${units / 1_000_000n}.${String(units % 1_000_000n).padStart(6, '0')}`.replace(/\.?0+$/, '');
  }
  return result;
}
