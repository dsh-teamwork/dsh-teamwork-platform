import { describe, expect, it } from 'vitest';

import { googleConfigured } from '../options';

// A self-hosted instance without an OAuth client must offer the emailed code
// alone: no Google provider registered, no button that can only fail.
describe('googleConfigured', () => {
  it('is off without a client id and secret', () => {
    expect(googleConfigured({})).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_ID: '', AUTH_GOOGLE_SECRET: '' })).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_ID: 'id.apps.googleusercontent.com' })).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_ID: '  ', AUTH_GOOGLE_SECRET: 'secret' })).toBe(false);
  });

  it('is on with both', () => {
    expect(googleConfigured({ AUTH_GOOGLE_ID: 'id.apps.googleusercontent.com', AUTH_GOOGLE_SECRET: 'secret' })).toBe(true);
  });
});
