import { describe, expect, it } from 'vitest';
import { joinLink, normalizePairingCode, pairingLink, sameServer } from '../links';

describe('the pairing screen’s input', () => {
  it('reads a code however it was typed', () => {
    expect(normalizePairingCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizePairingCode('ABCD 2345')).toBe('ABCD2345');
  });

  it('redeems a scanned code only against the server the member signed in to', () => {
    expect(sameServer(undefined, 'https://www.dshteamwork.com')).toBe(true);
    expect(sameServer('https://www.dshteamwork.com/', 'https://www.dshteamwork.com')).toBe(true);
    expect(sameServer('https://teamwork.example.com', 'https://www.dshteamwork.com')).toBe(false);
    expect(sameServer('not a url', 'https://www.dshteamwork.com')).toBe(false);
  });
});

describe('a scanned QR code', () => {
  it('reads the panel’s link: the code, its server and the computer’s key', () => {
    const link = `dshteamwork://pair?${new URLSearchParams({ server: 'https://www.dshteamwork.com', code: 'k7q2zx', key: 'a+b/c=' })}`;
    expect(pairingLink(link)).toEqual({ code: 'K7Q2ZX', server: 'https://www.dshteamwork.com', key: 'a+b/c=' });
    expect(pairingLink(' dshteamwork://pair?code=K7Q2ZX ')).toEqual({ code: 'K7Q2ZX', server: undefined, key: undefined });
  });

  it('is not a pairing for any other code or a code of the wrong length', () => {
    expect(pairingLink('https://www.dshteamwork.com/teams?invite=x')).toBeNull();
    expect(pairingLink('dshteamwork://sign-in?code=K7Q2ZX')).toBeNull();
    expect(pairingLink('dshteamwork://pair?code=K7Q2')).toBeNull();
    expect(pairingLink('dshteamwork://pair?code=%E0%A4%A')).toBeNull();
  });
});

describe('a shared DSH\'s invite link', () => {
  it('reads every part, and refuses a link missing one or of another kind', () => {
    const link = 'dshteamwork://join?server=https%3A%2F%2Fteam.example&host=abc123&key=CAESIA%2Bkey%3D&invite=inv1&secret=s3cr3t';
    expect(joinLink(link)).toEqual({ server: 'https://team.example', host: 'abc123', key: 'CAESIA+key=', invite: 'inv1', secret: 's3cr3t' });
    expect(joinLink(link.replace('&secret=s3cr3t', ''))).toBeNull();
    expect(joinLink(link.replace('join?', 'pair?'))).toBeNull();
    expect(pairingLink(link)).toBeNull();
  });
});
