import { useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CopyButton } from '@/components/copy-button';
import { CardPage, Failure, useTitle } from '@/components/page';
import { Button } from '@/components/ui/button';
import { api, ApiError, type PluginCode, type TeamSummary } from '@/lib/api';
import { isLoopback } from '@/lib/return-path';
import { useSession } from '@/lib/session';
import { editionSecurity } from '@/lib/edition';
import { useApi } from '@/lib/use-api';

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where `/teamwork login` in DSH sends the browser (docs/adr/0001-plugin-sign-in.md):
 * confirm, then the code goes back — to the plugin's loopback listener or the
 * phone app's address when the link names one (ADR 0012, ADR 0010), otherwise
 * shown to copy. Any other address makes the link invalid; the server holds
 * the same rule when it mints the code.
 */
export function PluginPage() {
  const t = useTranslations('plugin');
  useTitle(t('title'));
  const { session, signOut } = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const challenge = params.get('challenge') ?? '';
  const redirectUri = params.get('redirect_uri');
  const [minted, setMinted] = useState<PluginCode | null>(null);
  const [failure, setFailure] = useState<'verification_required' | 'failed' | null>(null);
  const [pending, setPending] = useState(false);
  // What the code will reach: every team the account is in (the plugin syncs them all, ADR 0013).
  const teams = useApi<TeamSummary[]>(session.user && !session.user.mustChangePassword ? 'teams' : null);

  const to = redirectUri === null ? null : isLoopback(redirectUri) ? 'dsh' : redirectUri === session.appRedirect ? 'app' : undefined;
  const valid = CHALLENGE.test(challenge) && to !== undefined;
  if (!valid) return <CardPage title={t('title')} description={t('invalid')} wide />;
  const here = location.pathname + location.search;
  const appLogin = to === 'app' && session.appChallenge === challenge;
  if (!session.user && !appLogin) return <Navigate to={`/sign-in?next=${encodeURIComponent(here)}`} replace />;
  if (session.user?.mustChangePassword) return <Navigate to={`/password?next=${encodeURIComponent(here)}`} replace />;

  async function authorize() {
    setFailure(null);
    setPending(true);
    try {
      if (to === 'app') await editionSecurity()?.authorizeApp(challenge);
      const code = await api<PluginCode>('auth/plugin/code', { body: { challenge, ...(redirectUri ? { redirectUri } : {}) } });
      setMinted(code);
      if (code.returnTo) {
        const back = new URL(code.returnTo.url);
        back.searchParams.set('code', code.code);
        window.location.href = back.toString();
      }
    } catch (error) {
      setFailure(error instanceof ApiError && error.code === 'verification_required' ? 'verification_required' : 'failed');
    } finally {
      setPending(false);
    }
  }

  const line = minted && (minted.returnTo?.to === 'app' ? minted.code : `/teamwork authorize ${minted.code}`);
  return (
    <CardPage title={t('title')} description={t(to === 'app' ? 'descriptionApp' : 'description')} wide>
      {minted ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>{minted.returnTo ? t(minted.returnTo.to === 'dsh' ? 'returningDsh' : 'returning') : t('copy')}</p>
          {/* The whole line, wrapped, to select or copy: a field cut it off. */}
          <div className="flex items-start gap-2 rounded-md border bg-muted py-1.5 pr-1.5 pl-3">
            <code className="min-w-0 flex-1 py-1 font-mono text-xs [overflow-wrap:anywhere]">{line}</code>
            {line && <CopyButton text={line} />}
          </div>
          <p className="text-xs text-muted-foreground">{t('expiry')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* A phone's sign-in has no browser session, only its own handoff, so there is no account line to show. */}
          {session.user && (
            <div className="rounded-md border bg-muted px-3 py-2 text-sm">
              <p>{t('account', { email: session.user.email ?? '' })}</p>
              {to === 'dsh' && teams.data && <p className="text-muted-foreground">{t('scope', { count: teams.data.length })}</p>}
            </div>
          )}
          <Failure message={failure ? t(failure) : null} />
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" disabled={pending} onClick={() => void authorize()}>
              {t('confirm')}
            </Button>
            <Button asChild variant="outline">
              <Link to="/teams">{t('cancel')}</Link>
            </Button>
          </div>
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline underline-offset-4"
            onClick={async () => {
              await signOut();
              window.location.assign(`/sign-in?next=${encodeURIComponent(here)}`);
            }}
          >
            {t('notYou')}
          </button>
        </div>
      )}
    </CardPage>
  );
}
