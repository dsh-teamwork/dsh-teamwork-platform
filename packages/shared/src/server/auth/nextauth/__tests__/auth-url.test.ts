import { afterEach, describe, expect, it } from 'vitest';

import { createNextAuth } from '..';

const options = { cookieName: 'test-auth', afterSignIn: '/', signInPath: '/sign-in', emailCodes: false };
const saved = { APP_URL: process.env.APP_URL, AUTH_URL: process.env.AUTH_URL };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// Behind a proxy the request names the container, not the site; without a
// configured origin Auth.js sends Google a callback it never registered.
describe('the origin Auth.js builds its callback URLs from', () => {
  it('is APP_URL when AUTH_URL is unset', () => {
    delete process.env.AUTH_URL;
    process.env.APP_URL = 'https://www.example.com';
    createNextAuth(options);
    expect(process.env.AUTH_URL).toBe('https://www.example.com');
  });

  it('stays AUTH_URL when both are set', () => {
    process.env.AUTH_URL = 'https://auth.example.com';
    process.env.APP_URL = 'https://www.example.com';
    createNextAuth(options);
    expect(process.env.AUTH_URL).toBe('https://auth.example.com');
  });
});
