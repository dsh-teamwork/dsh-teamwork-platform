import { describe, expect, it } from 'vitest';

import { bearerFromHeader, isAdminEmail, returnPath, VerifyCodeSchema } from '../auth';

describe('bearerFromHeader', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['  Bearer   abc  ', 'abc'],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer a b', null],
    [null, null],
  ])('%j -> %j', (header, token) => {
    expect(bearerFromHeader(header)).toBe(token);
  });
});

describe('returnPath', () => {
  it.each([
    ['/settings?tab=a#x', '/settings?tab=a#x'],
    ['https://evil.example/', '/'],
    ['//evil.example/', '/'],
    ['/\\evil.example', '/'],
    ['/a\nb', '/'],
    ['settings', '/'],
    [undefined, '/'],
  ])('%j stays on this origin -> %j', (asked, expected) => {
    expect(returnPath(asked)).toBe(expected);
  });

  it('takes the fallback it is given', () => {
    expect(returnPath('//x', '/dashboard')).toBe('/dashboard');
  });
});

describe('isAdminEmail', () => {
  it('matches case- and space-insensitively', () => {
    expect(isAdminEmail(' Ops@Example.com ', 'a@example.com, ops@example.com')).toBe(true);
  });

  it('admits nobody when the allowlist is empty or unset', () => {
    expect(isAdminEmail('ops@example.com', '')).toBe(false);
    expect(isAdminEmail('ops@example.com', undefined)).toBe(false);
  });
});

describe('VerifyCodeSchema', () => {
  it('normalises the address and accepts only six digits', () => {
    expect(VerifyCodeSchema.parse({ email: ' A@Example.com ', code: ' 123456 ' })).toEqual({
      email: 'a@example.com',
      code: '123456',
    });
    expect(VerifyCodeSchema.safeParse({ email: 'a@example.com', code: '12345a' }).success).toBe(false);
  });
});
