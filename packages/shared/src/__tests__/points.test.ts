import { describe, expect, it } from 'vitest';

import { formatPoints } from '../points';

describe('formatPoints', () => {
  it('rounds half away from zero to a whole point, on the decimal string', () => {
    expect(formatPoints('194.916349266', 'en')).toBe('195');
    expect(formatPoints('2.5', 'en')).toBe('3');
    expect(formatPoints('2.499999999', 'en')).toBe('2');
    expect(formatPoints('0.4', 'en')).toBe('0');
    expect(formatPoints('-1.5', 'en')).toBe('-2');
    expect(formatPoints('-0.2', 'en')).toBe('0');
    expect(formatPoints(42, 'en')).toBe('42');
    // Past a float's exact integers, still exact.
    expect(formatPoints('9007199254740993.5', 'en')).toBe('9,007,199,254,740,994');
  });

  it('groups as the reader’s language does', () => {
    expect(formatPoints('1234567.89', 'en')).toBe('1,234,568');
    expect(formatPoints('1234567.89', 'zh-CN')).toBe('1,234,568');
  });

  it('leaves nothing for no amount, and what it cannot read as it is', () => {
    expect(formatPoints(null, 'en')).toBe('');
    expect(formatPoints(undefined, 'en')).toBe('');
    expect(formatPoints('—', 'en')).toBe('—');
  });
});
