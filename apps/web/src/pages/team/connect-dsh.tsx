/**
 * Connecting a person's own DSH, shared by the pages that lead to it: Home and the team overview open with
 * `ConnectDsh` until it is done, My DSH shows `SignInSteps` while no computer has signed in, and the toolbox says
 * where its presets and plugins show up. Done is read from the person's computers on the relay (`GET /relay/hosts`),
 * not from calls, so a page moves on as soon as DSH signs in.
 */

import { Check, CircleCheck, Laptop, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslations } from 'use-intl';

import { CopyButton } from '@/components/copy-button';
import { ownComputers } from '@/components/team/console-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Schemas } from '@/lib/api';
import { cn } from '@/lib/utils';

import { useTeam } from './layout';
import { useComputersChanged } from '@/lib/relay';
import { useSession } from '@/lib/session';

const LOGIN = '/teamwork login';
/** The plugin's npm name, what DSH installs (the plugin's README, "Install"). */
const PLUGIN = '@dsh-teamwork/dsh-teamwork';
/** The server the plugin signs in to unless told otherwise (the plugin's `DEFAULT_SERVER`); any other needs saying. */
const PLUGIN_DEFAULT_SERVER = 'https://www.dshteamwork.com';
type RelayHost = Schemas['RelayHost'];

/** The reader's own DSH: their computers on the relay, most recently seen first, and how far connecting it has got. */
export interface OwnDsh {
  /** Null until first read. */
  hosts: RelayHost[] | null;
  /** The computer whose DSH signed in to Teamwork last. */
  computer?: RelayHost;
  /** A browser or phone of the reader's is paired with one of them. */
  paired: boolean;
  /** Both, so the connect card gives way to one line. */
  done: boolean;
}

/** Reads the reader's computers, and again while connecting is not done, so the card moves on when DSH signs in. */
export function useOwnDsh(): OwnDsh {
  const [hosts, setHosts] = useState<RelayHost[] | null>(null);
  // A relay that cannot be read leaves the steps showing, as for someone with no computer yet.
  const load = useCallback(() => ownComputers().then(setHosts, () => setHosts((known) => known ?? [])), []);
  const computer = hosts?.[0];
  const paired = (hosts ?? []).some((h) => h.pairings.some((p) => p.status === 'confirmed'));
  const done = !!computer && paired;
  useEffect(() => void load(), [load]);
  // Until DSH signs in and pairs, the card moves on when a computer comes.
  useComputersChanged(useSession().session?.user?.id, load, !done);
  return { hosts, computer, paired, done };
}

/** Where this browser remembers that the reader put pairing off, per account: only the second step can be put off. */
const LATER_KEY = 'dsh-teamwork:connect-later:';

/**
 * Connecting the reader's own DSH, at the top of both summaries until it is done: sign DSH in to Teamwork on a computer,
 * then pair a browser (My DSH) or the phone app with it. Each step ticks itself off from the relay. Once DSH is signed in,
 * pairing can be put off; nothing shows until the computers are read.
 */
export function ConnectDsh({ dsh, base }: { dsh: OwnDsh; base: string }) {
  const { me } = useTeam();
  const t = useTranslations('team.overview.dsh');
  const [later, setLater] = useState(() => {
    try {
      return localStorage.getItem(LATER_KEY + me) === '1';
    } catch {
      return false;
    }
  });
  if (!dsh.hosts || dsh.done || (dsh.computer && later)) return null;
  const signedIn = !!dsh.computer;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('lede')}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <ol>
          <li className="flex gap-3 border-t px-6 py-4">
            <Mark n={1} done={signedIn} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className={cn('text-sm font-medium', signedIn && 'text-muted-foreground')}>{t('signIn.title')}</span>
              {signedIn ? (
                <span className="text-xs text-muted-foreground">{t('signIn.done', { name: dsh.computer!.name })}</span>
              ) : (
                <SignInSteps />
              )}
            </div>
          </li>
          <li className="flex gap-3 border-t px-6 py-4">
            <Mark n={2} done={dsh.paired} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <span className="flex flex-col gap-0.5">
                <span className={cn('text-sm font-medium', !signedIn && 'text-muted-foreground')}>{t('pair.title')}</span>
                <span className="text-xs text-muted-foreground">{t('pair.hint')}</span>
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Laptop className="size-4 text-muted-foreground" aria-hidden />
                    {t('pair.browserTitle')}
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground">{t('pair.browserBody')}</span>
                  <Button asChild size="sm" variant={signedIn ? 'default' : 'outline'} className="self-start">
                    <Link to={`${base}/my-dsh`}>{t('pair.browserAction')}</Link>
                  </Button>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Smartphone className="size-4 text-muted-foreground" aria-hidden />
                    {t('pair.phoneTitle')}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('pair.phoneBody')}</span>
                </div>
              </div>
              {signedIn && (
                <button
                  type="button"
                  className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  onClick={() => {
                    try {
                      localStorage.setItem(LATER_KEY + me, '1');
                    } catch {
                      // Put off for this visit only.
                    }
                    setLater(true);
                  }}
                >
                  {t('pair.later')}
                </button>
              )}
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

/** The reader's DSH once connected: one line, opening it in My DSH. */
export function DshConnected({ dsh, base }: { dsh: OwnDsh; base: string }) {
  const t = useTranslations('team.overview.dsh');
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <CircleCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('connected')}
          </CardTitle>
          <span className="truncate text-xs text-muted-foreground">{t('connectedHint', { name: dsh.computer?.name ?? '' })}</span>
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to={`${base}/my-dsh`}>{t('open')}</Link>
        </Button>
      </CardHeader>
    </Card>
  );
}

/** Signing DSH in to Teamwork on a computer: the plugin to install, the command to run, and the server where it is not the plugin's own. */
export function SignInSteps() {
  const t = useTranslations('team.overview.dsh');
  const server = window.location.origin;
  const code = (chunks: ReactNode) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">{chunks}</code>;
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <span>{t.rich('signIn.install', { link: (chunks) => <a href="/docs/install" className="text-foreground underline underline-offset-4">{chunks}</a> })}</span>
      <Command text={PLUGIN} />
      <span>{t('signIn.login')}</span>
      <Command text={LOGIN} />
      {/* The plugin signs in to the hosted service unless told otherwise: any other server is worth saying. */}
      {server !== PLUGIN_DEFAULT_SERVER && <span className="[overflow-wrap:anywhere]">{t.rich('signIn.server', { server, code })}</span>}
      <span className="text-xs">{t('signIn.waiting')}</span>
    </div>
  );
}

/** A text to type into DSH, with its copy button. */
function Command({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2 rounded-md border bg-muted py-1.5 pr-1.5 pl-3 font-mono text-sm text-foreground">
      <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{text}</span>
      <CopyButton text={text} />
    </span>
  );
}

/** A step's number, or its tick once done. */
export function Mark({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
        done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

