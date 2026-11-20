/**
 * How a client shows an amount of points: rounded half away from zero to a whole point and grouped as the reader's
 * language groups numbers (`194.916349266` → `195`, `1234.5` → `1,235`). The server keeps nine decimals so sums and
 * holds stay exact; a person reads whole points. Rounding reads the decimal string's first fraction digit, never a
 * float, and the whole part is exact up to 2^53 points. It formats a number, not a BigInt, which the phone app's
 * Hermes cannot format.
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
  const rounded = Number(whole) + (fraction !== '' && fraction[0]! >= '5' ? 1 : 0);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(sign && rounded !== 0 ? -rounded : rounded);
}
