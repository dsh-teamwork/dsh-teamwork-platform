import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { CardPage, Failure, Loading } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type PluginCode } from '@/lib/api';
import { isLoopback } from '@/lib/return-path';
import { useSession } from '@/lib/session';

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
  const { session } = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  const challenge = params.get('challenge') ?? '';
  const redirectUri = params.get('redirect_uri');
  const [minted, setMinted] = useState<PluginCode | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  if (!session) return <Loading />;
  const to = redirectUri === null ? null : isLoopback(redirectUri) ? 'dsh' : session.mobileRedirectPrefix && redirectUri.startsWith(session.mobileRedirectPrefix) ? 'app' : undefined;
  const valid = CHALLENGE.test(challenge) && to !== undefined;
  if (!valid) return <CardPage title={t('title')} description={t('invalid')} wide />;
  const here = location.pathname + location.search;
  if (!session.user) return <Navigate to={`/sign-in?next=${encodeURIComponent(here)}`} replace />;
  if (session.user.mustChangePassword) return <Navigate to={`/password?next=${encodeURIComponent(here)}`} replace />;

  async function authorize() {
    setFailed(false);
    setPending(true);
    try {
      const code = await api<PluginCode>('auth/plugin/code', { body: { challenge, ...(redirectUri ? { redirectUri } : {}) } });
      setMinted(code);
      if (code.returnTo) {
        const back = new URL(code.returnTo.url);
        back.searchParams.set('code', code.code);
        window.location.href = back.toString();
      }
    } catch {
      setFailed(true);
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
          <Input readOnly value={line ?? ''} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
          <p className="text-xs text-muted-foreground">{t('expiry')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Failure message={failed ? t('failed') : null} />
          <Button disabled={pending} onClick={() => void authorize()}>
            {t('confirm')}
          </Button>
        </div>
      )}
    </CardPage>
  );
}
