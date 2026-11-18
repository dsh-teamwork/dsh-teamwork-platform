import { ArrowLeft, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { useState, type ComponentType, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { useTitle } from '@/components/page';
import { LocalePicker } from '@/components/locale-picker';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type Session } from '@/lib/api';
import { AUTH_ERRORS, authError, type AuthError } from '@/lib/auth-error';
import { returnPath } from '@/lib/return-path';
import { useSession } from '@/lib/session';

/** An `?error=` a sign-in round trip came back with; anything not ours reads as `unavailable`. */
function fromQuery(value: string | null): AuthError | null {
  if (!value) return null;
  return (AUTH_ERRORS as readonly string[]).includes(value) ? (value as AuthError) : 'unavailable';
}

/**
 * Google's four-colour G, as Google's sign-in branding requires; its hexes are
 * the one literal colour in the console (docs/design.md, "Component rules").
 */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * The OAuth doors this console can draw, in the order they are listed; each
 * shows only where the server's session says it is configured (`doors`).
 */
const OAUTH: { door: keyof Session['doors']; label: 'google'; start: string; Mark: ComponentType<{ className?: string }> }[] = [
  { door: 'google', label: 'google', start: '/api/auth/google', Mark: GoogleMark },
];

/** The navy plate's side of the screen: the mark, the promise and a layered sea, from the brand tokens. */
function BrandPanel() {
  const tc = useTranslations('common');
  const th = useTranslations('home');
  return (
    <aside className="relative hidden overflow-hidden bg-brand text-brand-foreground lg:flex lg:flex-col">
      <a href="/" className="relative z-10 flex items-center gap-2.5 p-10 text-lg font-bold tracking-tight">
        <img src="/logo.svg" alt="" width={32} height={32} className="rounded-[22%] ring-1 ring-brand-foreground/25" />
        {tc('appName')}
      </a>
      <div className="relative z-10 mt-[12vh] max-w-md px-10">
        <p className="font-[Georgia,'Noto_Serif_CJK_SC','Songti_SC',serif] text-4xl leading-tight font-semibold tracking-tight">{th('title')}</p>
        <p className="mt-5 text-base leading-relaxed opacity-80">{th('lede')}</p>
      </div>
      {/* The mark's sea, settling in layers: flat bands of the plate's own foreground. */}
      <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-2/5 w-full" aria-hidden fill="currentColor">
        <path opacity=".08" d="M0 40 Q50 28 100 40 T200 40 T300 40 T400 40 V160 H0Z" />
        <path opacity=".08" d="M0 78 Q50 70 100 78 T200 78 T300 78 T400 78 V160 H0Z" />
        <path opacity=".1" d="M0 114 Q50 109 100 114 T200 114 T300 114 T400 114 V160 H0Z" />
      </svg>
    </aside>
  );
}

/** A field with an icon at its start. */
function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        {children}
      </div>
    </div>
  );
}

/**
 * Signing in: every OAuth door the server offers, then one email door — an
 * emailed code where the instance sends email, a password where it does not
 * (ADR 0006).
 */
export function SignInPage() {
  const t = useTranslations('signIn');
  const te = useTranslations('authErrors');
  const tc = useTranslations('common');
  useTitle(t('title'));
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = returnPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<AuthError | null>(fromQuery(params.get('error')));
  const [pending, setPending] = useState<string | null>(null);

  if (session.user) return <Navigate to={session.user.mustChangePassword ? `/password?next=${encodeURIComponent(next)}` : next} replace />;
  const { doors } = session;
  const oauth = OAUTH.filter((provider) => doors[provider.door]);

  async function run(what: string, action: () => Promise<void>) {
    setError(null);
    setPending(what);
    try {
      await action();
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(null);
    }
  }

  async function signedIn(mustChangePassword = false) {
    await refresh();
    navigate(mustChangePassword ? `/password?next=${encodeURIComponent(next)}` : next, { replace: true });
  }

  const busy = pending !== null;
  const spinner = (what: string) => pending === what && <Loader2 className="animate-spin" aria-hidden />;
  const subtitle = doors.password ? (oauth.length ? 'subtitlePasswordGoogle' : 'subtitlePassword') : oauth.length ? 'subtitle' : 'subtitleEmailOnly';

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 items-center gap-2 px-6">
          <a href="/" className="mr-auto flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            {tc('backHome')}
          </a>
          <ThemeToggle />
          <LocalePicker className="h-9" />
        </header>

        <main className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">
            <img src="/logo.svg" alt="" width={44} height={44} className="mb-6 lg:hidden" />
            <h1 className="text-2xl font-semibold tracking-tight">{codeSent ? t('checkEmail') : t('title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{codeSent ? t('codeSent', { email }) : t(subtitle)}</p>

            <div className="mt-8 flex flex-col gap-6">
              {doors.password && session.setupOpen && (
                <p className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">{t('setupHint')}</p>
              )}

              {!codeSent && oauth.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {oauth.map(({ door, label, start, Mark }) => (
                    <Button
                      key={door}
                      variant="outline"
                      size="lg"
                      className="w-full"
                      disabled={busy}
                      onClick={() => {
                        setPending(door);
                        window.location.assign(`${start}?next=${encodeURIComponent(next)}`);
                      }}
                    >
                      {pending === door ? <Loader2 className="animate-spin" aria-hidden /> : <Mark className="size-4" />}
                      {t(label)}
                    </Button>
                  ))}
                  <div className="mt-3.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {t('orEmail')}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </div>
              )}

              {doors.password ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run('password', async () => {
                      const { mustChangePassword } = await api<{ mustChangePassword: boolean }>('auth/password/sign-in', { body: { email, password } });
                      await signedIn(mustChangePassword);
                    });
                  }}
                >
                  <Field id="email" label={t('email')} icon={Mail}>
                    <Input id="email" type="email" autoComplete="username" required autoFocus={!oauth.length} placeholder={t('emailPlaceholder')} className="h-10 pl-9" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                  <Field id="password" label={t('password')} icon={Lock}>
                    <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required className="h-10 px-9" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={t(showPassword ? 'hidePassword' : 'showPassword')}
                      title={t(showPassword ? 'hidePassword' : 'showPassword')}
                      className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </Field>
                  <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
                    {spinner('password')}
                    {t('verify')}
                  </Button>
                </form>
              ) : doors.emailCode && !codeSent ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run('send', async () => {
                      await api('auth/email/send', { body: { email } });
                      setCodeSent(true);
                    });
                  }}
                >
                  <Field id="email" label={t('email')} icon={Mail}>
                    <Input id="email" type="email" autoComplete="email" required autoFocus={!oauth.length} placeholder={t('emailPlaceholder')} className="h-10 pl-9" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                  <Button type="submit" size="lg" className="w-full" disabled={busy}>
                    {spinner('send')}
                    {t('sendCode')}
                  </Button>
                </form>
              ) : doors.emailCode ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run('verify', async () => {
                      await api('auth/email/verify', { body: { email, code } });
                      await signedIn();
                    });
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="code">{t('code')}</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      pattern="\d{6}"
                      maxLength={6}
                      required
                      placeholder="000000"
                      className="h-12 indent-[0.5em] text-center font-mono text-xl tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-muted-foreground/40"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
                    {spinner('verify')}
                    {t('verify')}
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setCodeSent(false);
                        setCode('');
                        setError(null);
                      }}
                    >
                      {t('useAnotherEmail')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-brand hover:underline disabled:opacity-50 dark:text-foreground"
                      onClick={() => void run('send', () => api('auth/email/send', { body: { email } }).then(() => setCode('')))}
                    >
                      {t('resend')}
                    </button>
                  </div>
                </form>
              ) : null}

              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                  {te(error)}
                </p>
              )}

              {doors.password && <p className="text-center text-xs text-muted-foreground">{t('noAccount')}</p>}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
