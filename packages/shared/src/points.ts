/**
 * How a client shows an amount of points: rounded half away from zero to a whole point and grouped as the reader's
 * language groups numbers (`194.916349266` → `195`, `1234.5` → `1,235`). The server keeps nine decimals so sums and
 * holds stay exact; a person reads whole points. Rounding works on the decimal string, never through a float.
 *
 * Only for amounts (spent, left, held, a limit). A rate — points per million tokens — keeps its decimals: rounding
 * a price of 0.3 to 0 would misstate it.
 */
export function formatPoints(value: string | number | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return '';
  const text = typeof value === 'number' ? String(value) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = ''] = match;
  let rounded = BigInt(whole) + (fraction !== '' && fraction[0]! >= '5' ? 1n : 0n);
  if (sign && rounded !== 0n) rounded = -rounded;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(rounded);
}
