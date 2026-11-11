import { describe, expect, it } from 'vitest';

import type { Identity } from '../../../auth';
import { admitted, passwordsConfigured } from '../options';

const identity = (via: Identity['via']): Identity => ({ strategy: 'supabase', subject: 's', email: 'ops@example.com', via });

describe('admitted', () => {
  it('lets an app with email codes act on either door', () => {
    expect(admitted({ emailCodes: true }, identity('email'))).not.toBeNull();
  });

  it('refuses an emailed-code or password session in a Google-only app, however it was obtained', () => {
    expect(admitted({ emailCodes: false }, identity('email'))).toBeNull();
    expect(admitted({ emailCodes: false }, identity('password'))).toBeNull();
    expect(admitted({ emailCodes: false }, identity('google'))).not.toBeNull();
  });
});

describe('passwordsConfigured', () => {
  it('makes the email door a password exactly where no SMTP is configured', () => {
    expect(passwordsConfigured({})).toBe(true);
    expect(passwordsConfigured({ SMTP_URL: '  ' })).toBe(true);
    expect(passwordsConfigured({ SMTP_URL: 'smtps://user:pass@smtp.example.com:465' })).toBe(false);
  });
});
