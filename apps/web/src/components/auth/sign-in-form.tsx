'use client';

/**
 * The sign-in form, written once for either strategy: Google, or an email and
 * then a six-digit code. It calls the four actions by name from
 * `@/lib/auth/actions`, which is where the strategy is chosen, and words each
 * `AuthError` code in the reader's language.
 */

import { AUTH_ERRORS, type AuthError, type AuthResult } from '@dsh-teamwork/shared';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendCode, startGoogle, verifyCode } from '@/lib/auth/actions';

/**
 * An `?error=` the page was sent back with. Ours are `AuthError` codes; an
 * identity provider's own names (Auth.js's `AccessDenied`, say) are not worth
 * a sentence each, so they read as `unavailable`.
 */
function fromQuery(value: string | undefined): AuthError | null {
  if (!value) return null;
  return (AUTH_ERRORS as readonly string[]).includes(value) ? (value as AuthError) : 'unavailable';
}

export function SignInForm({ next, google, initialError }: { next: string; google: boolean; initialError?: string }) {
  const t = useTranslations('signIn');
  const te = useTranslations('authErrors');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<AuthError | null>(fromQuery(initialError));
  const [pending, startTransition] = useTransition();

  // A successful action redirects, so only a failure ever comes back here.
  function run(action: () => Promise<AuthResult | void>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result) return;
      if (result.ok) onOk?.();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {google && (
        <>
          <Button variant="outline" disabled={pending} onClick={() => run(() => startGoogle(next))}>
            {t('google')}
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t('or')}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {!codeSent ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => sendCode(email), () => setCodeSent(true));
          }}
        >
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" disabled={pending}>
            {t('sendCode')}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => verifyCode(email, code, next));
          }}
        >
          <p className="text-sm text-muted-foreground">{t('codeSent', { email })}</p>
          <Label htmlFor="code">{t('code')}</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" disabled={pending}>
            {t('verify')}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setCodeSent(false);
              setCode('');
            }}
          >
            {t('useAnotherEmail')}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {te(error)}
        </p>
      )}
    </div>
  );
}
