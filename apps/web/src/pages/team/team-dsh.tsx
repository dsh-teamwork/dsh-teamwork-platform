/**
 * Team DSH (`/teams/{teamId}/team-dsh[/{computerId}[/{sessionId}]]`), a member's side of a team's shared DSHs
 * (docs/tech/shared-dsh.md, "Clients"), in Workspace. It fills the area beside the console's sidebar: a column of the
 * DSHs they may reach, with their sessions on the open one beneath it, and the conversation beside. Joining one takes
 * the invite its admin handed over; sessions are driven through the relay end to end encrypted as the phone app drives
 * them (`@dsh-teamwork/relay-client`, `@/lib/relay`). The DSH decides what this member sees: only the sessions they
 * started, and nothing until their PIN unlocks the channel. Managing the keys, access and archive is the admin's
 * page under Team assets (team-dsh-hosts.tsx). A team the server has not enabled Team DSH for sees what it offers and
 * who enables it instead; the entry is in every team's sidebar.
 */

import { Plus, Server } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslations } from 'use-intl';

import { joinLink, sameServer, type Computer, type SharedHost } from '@dsh-teamwork/relay-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { browserCanJoin, relayFor } from '@/lib/relay';
import { cn } from '@/lib/utils';

import { ComputerRow, Conversation, DshColumns, NewSession, PinGate, row, selected, SessionList, useComputer, useRelayError } from './dsh-session';
import { useTeam } from './layout';

/** The team's DSHs this member may reach and their sessions on the one open, beside the conversation. */
export function TeamDshPage() {
  const { team, me } = useTeam();
  const { computerId = '', sessionId = '' } = useParams();
  const t = useTranslations('team.teamDsh');
  const tt = useTranslations('team.dsh');
  const word = useRelayError();
  const navigate = useNavigate();
  const relay = relayFor(me);
  const base = `/teams/${team.id}/team-dsh`;
  const [hosts, setHosts] = useState<SharedHost[] | null>(null);
  // Whether the server lets this team run a Team DSH; one it has not enabled sees what it is and who enables it.
  const [unavailable, setUnavailable] = useState(false);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const { sessions, pin, failed: unreachable, reload, locked } = useComputer(computerId);

  const loadHosts = useCallback(async () => {
    try {
      const [reachable, paired] = await Promise.all([relay.sharedHosts(), relay.listComputers()]);
      setHosts(reachable.hosts.filter((h) => h.teamId === team.id));
      setUnavailable(reachable.unavailableTeamIds.includes(team.id));
      setComputers(paired);
    } catch (error) {
      setFailed(word(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [relay, team.id]);
  useEffect(() => void loadHosts(), [loadHosts]);

  const computer = computers.find((c) => c.id === computerId);
  const session = sessions?.find((s) => s.id === sessionId);
  const problem = failed ?? unreachable;

  if (unavailable) return <NotEnabled />;
  return (
    <DshColumns
      title={t('title')}
      list={(onPick) => (
        <>
          {hosts?.length === 0 && <p className="px-2.5 text-muted-foreground">{t('none')}</p>}
          {hosts?.map((host) => {
            const paired = computers.find((c) => c.hostId === host.id);
            const open = paired !== undefined && paired.id === computerId;
            return (
              <div key={host.id} className="flex flex-col gap-0.5">
                <ComputerRow
                  name={host.name}
                  note={paired ? undefined : t('needsInvite')}
                  online={paired ? host.online : undefined}
                  to={paired && `${base}/${paired.id}`}
                  open={open}
                  current={open && !sessionId}
                  onPick={onPick}
                />
                {open && <SessionList base={`${base}/${paired.id}`} locked={locked} sessions={sessions} sessionId={sessionId} onPick={onPick} />}
              </div>
            );
          })}
          <Link to={base} onClick={onPick} className={cn(row, 'mt-2 gap-2.5 text-muted-foreground', !computerId && selected)}>
            <Plus className="size-4" aria-hidden />
            {t('joinWithInvite')}
          </Link>
        </>
      )}
    >
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {!computerId ? (
        <Join joined={(id) => { void loadHosts(); navigate(`${base}/${id}`); }} />
      ) : locked ? (
        <PinGate computerId={computerId} state={pin} lockedHint={t('lockedHint')} />
      ) : sessionId ? (
        <Conversation key={sessionId} computerId={computerId} sessionId={sessionId} title={session?.title || tt('untitled')} />
      ) : (
        <NewSession key={computerId} computerId={computerId} name={computer?.name ?? ''} started={(id) => { void reload(); navigate(`${base}/${computerId}/${id}`); }} />
      )}
    </DshColumns>
  );
}

const FEATURES = ['Machine', 'Models', 'Private', 'Audit'] as const;

/**
 * A team the server has not enabled Team DSH for: what it offers and who enables it, so the entry stays in the
 * sidebar for every team rather than appearing only once it is enabled. An admin is sent to support, a member to
 * their admin.
 */
function NotEnabled() {
  const { team } = useTeam();
  const t = useTranslations('team.teamDsh');
  const admin = team.role === 'admin';
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <Server className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('pitch')}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((key) => (
          <li key={key} className="flex flex-col gap-1 rounded-lg border p-4">
            <span className="text-sm font-medium">{t(`feature${key}Title`)}</span>
            <span className="text-sm text-muted-foreground">{t(`feature${key}Body`)}</span>
          </li>
        ))}
      </ul>
      <div role="status" className="flex flex-col gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
        <p>{admin ? t('notEnabledAdmin') : t('notEnabledMember')}</p>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <Button asChild size="sm">
              <a href="mailto:support@dshteamwork.com">{t('contactSupport')}</a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <a href="/docs/team-dsh">{t('learnMore')}</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

/** No DSH open: what a Team DSH is, and joining one with the invite its admin handed over. */
function Join({ joined }: { joined: (computerId: string) => void }) {
  const { me, team } = useTeam();
  const t = useTranslations('team.teamDsh');
  const word = useRelayError();
  const relay = relayFor(me);
  const [invite, setInvite] = useState('');
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function join(event: FormEvent) {
    event.preventDefault();
    const link = joinLink(invite);
    if (!link) return setFailed(t('inviteInvalid'));
    if (!sameServer(link.server, window.location.origin)) return setFailed(t('inviteOtherServer'));
    if (!(await browserCanJoin())) return setFailed(t('browserUnsupported'));
    setJoining(true);
    setFailed(null);
    try {
      const pairing = await relay.join(link, t('deviceName'));
      setInvite('');
      joined(pairing.id);
    } catch (error) {
      setFailed(word(error));
    } finally {
      setJoining(false);
    }
  }

  return (
    <section className="m-auto flex w-full max-w-lg flex-col items-center gap-3 py-10 text-center">
      <Server className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-xl font-semibold tracking-tight">{t('introTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('disclosure')}</p>
      <form className="mt-4 flex w-full flex-col gap-2 text-left text-sm" onSubmit={(event) => void join(event)}>
        <label className="flex flex-col gap-1.5 font-medium">
          {t('joinWithInvite')}
          <span className="flex gap-2">
            <Input value={invite} required placeholder="dshteamwork://join?…" onChange={(event) => setInvite(event.target.value)} />
            <Button type="submit" disabled={joining || !invite.trim()}>{joining ? t('joining') : t('join')}</Button>
          </span>
        </label>
        <p className="text-xs text-muted-foreground">{t('joinHelp')}</p>
        {failed && <p role="alert" className="text-destructive">{failed}</p>}
      </form>
      {team.role === 'admin' && (
        <p className="text-xs text-muted-foreground">
          {t.rich('setUp', { link: (chunks) => <Link to={`/teams/${team.id}/team-dsh-hosts`} className="text-foreground underline underline-offset-4">{chunks}</Link> })}
        </p>
      )}
    </section>
  );
}
