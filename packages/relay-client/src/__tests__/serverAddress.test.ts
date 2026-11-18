import { describe, expect, it } from 'vitest';
import { serverAddress, ServerAddressError } from '../server-address';

function code(input: string) {
  try {
    serverAddress(input);
    return null;
  } catch (error) {
    return error instanceof ServerAddressError ? error.code : 'threw something else';
  }
}

describe('serverAddress (mirrors the plugin)', () => {
  it.each([
    ['https://www.dshteamwork.com', 'https://www.dshteamwork.com'],
    ['  https://www.dshteamwork.com/  ', 'https://www.dshteamwork.com'],
    ['https://example.com/teamwork//', 'https://example.com/teamwork'],
    ['HTTPS://Example.COM:8443', 'https://example.com:8443'],
    ['http://localhost:3800/', 'http://localhost:3800'],
    ['http://127.0.0.1:3800', 'http://127.0.0.1:3800'],
    ['http://[::1]:3800', 'http://[::1]:3800'],
  ])('normalises %s', (input, expected) => {
    expect(serverAddress(input)).toBe(expected);
  });

  it.each([
    ['', 'invalid'],
    ['www.dshteamwork.com', 'invalid'],
    ['http://www.dshteamwork.com', 'insecure'],
    ['http://192.168.1.10:3800', 'insecure'],
    ['ftp://localhost', 'insecure'],
    ['https://example.com/?a=1', 'extra'],
    ['https://example.com/#x', 'extra'],
    ['https://user:pass@example.com', 'extra'],
  ])('refuses %j as %s', (input, expected) => {
    expect(code(input)).toBe(expected);
  });
});
