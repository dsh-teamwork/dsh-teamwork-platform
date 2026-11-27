/**
 * `/teams`: every team the person is in, and where they create one or join
 * one by invitation. In the site's frame (components/site-frame.tsx), the teams
 * as cards in two groups (the ones they manage, the ones they joined), each
 * with its main pages one click away; a first visit gets a welcome instead.
 * Creating and joining open dialogs, and an `?invite=` link opens the join
 * dialog filled in.
 */

import { ArrowRight, ChartColumn, Cpu, House, LayoutDashboard, Layers, LogIn, Plus, Users } from 'lucide-react';
import { createElement, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { Failure, useTitle } from '@/components/page';
import { SiteFrame } from '@/components/site-frame';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type TeamSummary } from '@/lib/api';
import { editionTeamsNotice } from '@/lib/edition';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

/** An invitation is shared as a link; whoever pastes the whole link gets the token out of it. */
function tokenFrom(value: string): string {
  try {
    return new URL(value).searchParams.get('invite') ?? value;
  } catch {
    return value.trim();
  }
}

export function TeamsPage() {
  const { session } = useSession();
  const word = useTeamError();
  const [params] = useSearchParams();
  const teams = useApi<TeamSummary[]>('teams');
  const Notice = editionTeamsNotice();
  useTitle(useTranslations('team.list')('title'));
  return (
    <SiteFrame>
      {Notice && createElement(Notice)}
      {teams.data ? (
        <TeamsHome teams={teams.data} invite={params.get('invite') ?? ''} passwords={session.doors.password} reload={teams.reload} />
      ) : (
        teams.error ? <Failure message={word(teams.error)} /> : null
      )}
    </SiteFrame>
  );
}

function TeamsHome({ teams, invite, passwords, reload }: { teams: TeamSummary[]; invite: string; passwords: boolean; reload: () => Promise<unknown> }) {
  const t = useTranslations('team.list');
  // Where the instance holds passwords, an admin adds people: there is no invitation to join by.
  const [dialog, setDialog] = useState<'create' | 'join' | null>(invite && !passwords ? 'join' : null);
  const actions = (
    <div className="flex flex-wrap gap-2">
      {!passwords && (
        <Button variant="outline" onClick={() => setDialog('join')}>
          <LogIn />
          {t('joinAction')}
        </Button>
      )}
      <Button onClick={() => setDialog('create')}>
        <Plus />
        {t('createAction')}
      </Button>
    </div>
  );

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="max-w-xl text-muted-foreground">{teams.length ? t('subtitle') : t('subtitleEmpty')}</p>
        </div>
        {teams.length > 0 && actions}
      </header>

      {teams.length === 0 ? (
        <Welcome actions={actions} passwords={passwords} />
      ) : (
        (['admin', 'member'] as const).map((role) => {
          const group = teams.filter((team) => team.role === role);
          if (!group.length) return null;
          return (
            <section key={role} className="flex flex-col gap-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {t(role)}
                <span className="font-normal text-muted-foreground tabular-nums">{group.length}</span>
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((team) => (
                  <TeamCard key={team.id} team={team} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      <aside className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted px-5 py-4 text-sm">
        <span className="text-muted-foreground">{t('connectHint')}</span>
        <a href="/docs/install" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          {t('connectLink')}
          <ArrowRight className="size-4" aria-hidden />
        </a>
      </aside>

      {dialog === 'create' && <CreateDialog reload={reload} onClose={() => setDialog(null)} />}
      {dialog === 'join' && <JoinDialog invite={invite} reload={reload} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Up to two letters for a team's mark: the first of its first two words ("Acme Infra" → "AI"), or its first character. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? '?')][0];
  return letters.toUpperCase();
}

/** One team: its name and the person's role in it, opening its home, with its main pages a click away. */
function TeamCard({ team }: { team: TeamSummary }) {
  const t = useTranslations('team');
  const base = `/teams/${team.id}`;
  // Work for everyone; an admin's shortcuts are to the team's management, opening on its overview (ADR 0043, 0049).
  const links =
    team.role === 'admin'
      ? ([
          { path: '/overview', key: 'overview', icon: LayoutDashboard },
          { path: '/models', key: 'models', icon: Cpu },
          { path: '/members', key: 'members', icon: Users },
        ] as const)
      : ([
          { path: '/home', key: 'home', icon: House },
          { path: '/presets', key: 'library', icon: Layers },
          { path: '/my-usage', key: 'myUsage', icon: ChartColumn },
        ] as const);
  return (
    <li className="group relative flex flex-col rounded-xl border bg-card transition-colors hover:border-ring">
      <div className="flex items-start gap-4 p-5">
        {/* The team's own mark: its initials on navy, which says "this is the team's" (docs/design.md). The product logo stays in the top bar. */}
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand text-base font-semibold text-brand-foreground">
          {initials(team.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* The name is the card's link; the overlay makes the whole upper part open the team. */}
          <Link to={base} className="truncate text-lg font-semibold after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
            {team.name}
          </Link>
          <span className="text-sm text-muted-foreground">{t('list.members', { count: team.memberCount })}</span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            team.role === 'admin' ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground',
          )}
        >
          {t(`role.${team.role}`)}
        </span>
      </div>
      <nav aria-label={team.name} className="relative z-10 mt-auto flex border-t">
        {links.map(({ path, key, icon: Icon }) => (
          <Link
            key={key}
            to={base + path}
            className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground [&+&]:border-l"
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`nav.${key}`)}
          </Link>
        ))}
      </nav>
    </li>
  );
}

/** A first visit: what a team is for, and the two ways in. */
function Welcome({ actions, passwords }: { actions: ReactNode; passwords: boolean }) {
  const t = useTranslations('team.list');
  return (
    <section className="grid gap-8 overflow-hidden rounded-xl border p-6 sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <img src="/logo.svg" alt="" width={56} height={56} />
        <h2 className="text-2xl font-bold tracking-tight">{t('welcomeTitle')}</h2>
        <p className="max-w-lg text-muted-foreground">{t(passwords ? 'welcomeBodyPasswords' : 'welcomeBody')}</p>
        {actions}
      </div>
      <ol className="flex flex-col gap-4 self-center">
        {(['step1', 'step2', 'step3'] as const).map((step, i) => (
          <li key={step} className="flex gap-3 border-t pt-4 first:border-t-0 first:pt-0">
            <span className="font-mono text-sm font-semibold text-muted-foreground">0{i + 1}</span>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t(`${step}Title`)}</span>
              <span className="text-sm text-muted-foreground">{t(`${step}Body`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CreateDialog({ reload, onClose }: { reload: () => Promise<unknown>; onClose: () => void }) {
  const t = useTranslations('team.create');
  const tl = useTranslations('team.list');
  const { pending, run } = useMutation(reload);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          id="create-team"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const created = await api<{ id: string }>('teams', { body: { name } });
              navigate(`/teams/${created.id}`);
            }, t('done'));
          }}
        >
          <Label htmlFor="team-name">{t('name')}</Label>
          <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tl('cancel')}
          </Button>
          <Button type="submit" form="create-team" disabled={pending || !name.trim()}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinDialog({ invite, reload, onClose }: { invite: string; reload: () => Promise<unknown>; onClose: () => void }) {
  const t = useTranslations('team.join');
  const tl = useTranslations('team.list');
  const { pending, run } = useMutation(reload);
  const navigate = useNavigate();
  const [token, setToken] = useState(invite);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          id="join-team"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const joined = await api<{ teamId: string }>('invites/redeem', { body: { token: tokenFrom(token) } });
              navigate(`/teams/${joined.teamId}`);
            }, t('done'));
          }}
        >
          <Label htmlFor="invite-token">{t('token')}</Label>
          <Input id="invite-token" value={token} onChange={(e) => setToken(e.target.value)} required autoFocus />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tl('cancel')}
          </Button>
          <Button type="submit" form="join-team" disabled={pending || !token.trim()}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
