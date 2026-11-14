import { describe, expect, it } from 'vitest';

import { isLoopback, returnPath } from '@/lib/return-path';

describe('returnPath', () => {
  it('keeps a path on this site and refuses anything that leaves it', () => {
    expect(returnPath('/plugin?challenge=x')).toBe('/plugin?challenge=x');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/a\u0000b', null]) {
      expect(returnPath(bad)).toBe('/teams');
    }
  });
});

describe('isLoopback', () => {
  it('admits only plain http to 127.0.0.1 on an explicit port', () => {
    expect(isLoopback('http://127.0.0.1:5555/callback')).toBe(true);
    for (const bad of ['http://localhost:5555/', 'https://127.0.0.1:5555/', 'http://127.0.0.1/', 'http://u:p@127.0.0.1:1/']) {
      expect(isLoopback(bad)).toBe(false);
    }
  });
});
