/**
 * A member's side of a team's shared DSHs (docs/tech/shared-dsh.md, "Clients"): the ones they may reach, joining one
 * with the invite its admin handed over, and its sessions, driven through the relay end to end encrypted as the phone
 * app drives them (`@dsh-teamwork/relay-client`, `@/lib/relay`). The DSH decides what this member sees: only the
 * sessions they started, and nothing until their PIN unlocks the channel.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import { Link, useNavigate, useParams } from 'react-router';
import remarkGfm from 'remark-gfm';
import { useFormatter, useTranslations } from 'use-intl';

import {
  applySessionEvent,
  EMPTY_SESSION,
  isThinking,
  joinLink,
  pinPrompt,
  RelayError,
  rowsOf,
  sameServer,
  type Computer,
  type PinState,
  type SessionState,
  type SessionSummary,
  type SharedHost,
} from '@dsh-teamwork/relay-client';
import { PageHeader } from '@/components/team/console-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { browserCanJoin, relayFor } from '@/lib/relay';

import { useTeam } from './layout';

const WORDED = new Set(['offline', 'not_found', 'busy', 'stale', 'locked', 'invite_refused', 'device_key_changed', 'device_verification_required', 'no_directory', 'not_authenticated', 'missing_tools', 'missing_plugins', 'preset_unavailable', 'model_unavailable']);

/** A relay failure in the reader's words; anything unforeseen is "unavailable". */
function useRelayError() {
  const t = useTranslations('relayErrors');
  return (error: unknown) => t(error instanceof RelayError && WORDED.has(error.code) ? error.code : 'unavailable');
}

/** The shared DSHs of this team the member may reach, and joining one by invite. */
export function SharedReach() {
  const { team, me } = useTeam();
  const t = useTranslations('team.sharedDsh');
  const word = useRelayError();
  const navigate = useNavigate();
  const relay = relayFor(me);
  const [hosts, setHosts] = useState<SharedHost[] | null>(null);
  const [computers, setComputers] = useState<Computer[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [invite, setInvite] = useState('');
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const [reachable, paired] = await Promise.all([relay.sharedHosts(), relay.listComputers()]);
      setHosts(reachable.filter((h) => h.teamId === team.id));
      setComputers(paired);
      setFailed(null);
    } catch (error) {
      setFailed(word(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [relay, team.id]);
  useEffect(() => void load(), [load]);

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
      navigate(`/teams/${team.id}/shared-hosts/${pairing.id}`);
    } catch (error) {
      setFailed(word(error));
    } finally {
      setJoining(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reachTitle')}</CardTitle>
        <CardDescription>{t('disclosure')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {hosts?.length === 0 && <p className="text-muted-foreground">{t('none')}</p>}
        {hosts?.map((host) => {
          const computer = computers.find((c) => c.hostId === host.id);
          return (
            <div key={host.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{host.name}</span>
                <span className="text-xs text-muted-foreground">{host.online ? t('online') : t('offline')}</span>
              </div>
              {computer ? (
                <Button asChild size="sm">
                  <Link to={`/teams/${team.id}/shared-hosts/${computer.id}`}>{t('open')}</Link>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t('needsInvite')}</span>
              )}
            </div>
          );
        })}
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void join(event)}>
          <label className="flex min-w-64 flex-1 flex-col gap-1.5">
            {t('invite')}
            <Input value={invite} required placeholder="dshteamwork://join?…" onChange={(event) => setInvite(event.target.value)} />
          </label>
          <Button type="submit" disabled={joining || !invite.trim()}>{joining ? t('joining') : t('join')}</Button>
        </form>
        {failed && <p role="alert" className="text-destructive">{failed}</p>}
      </CardContent>
    </Card>
  );
}

/** One shared DSH this browser joined: the member's sessions on it, one open beside them. */
export function TeamSharedDshPage() {
  const { team, me } = useTeam();
  const { computerId = '' } = useParams();
  const t = useTranslations('team.sharedDsh');
  const word = useRelayError();
  const format = useFormatter();
  const relay = relayFor(me);
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pin, setPin] = useState<PinState | undefined>();

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await relay.listSessions(computerId));
      setFailed(null);
    } catch (error) {
      // Locked: the PIN gate says so.
      if (!(error instanceof RelayError && error.code === 'locked')) setFailed(word(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is a fresh closure each render.
  }, [relay, computerId]);

  useEffect(() => {
    void relay.listComputers().then((all) => setName(all.find((c) => c.id === computerId)?.name ?? ''), () => {});
    void loadSessions();
    const unwatch = relay.watchSessions(computerId, () => void loadSessions());
    const unpin = relay.watchPin(computerId, (state) => {
      setPin(state);
      if (state?.kind === 'unlocked') void loadSessions();
    });
    return () => { unwatch(); unpin(); };
  }, [relay, computerId, loadSessions]);

  async function start() {
    try {
      const created = await relay.createSession(computerId);
      setSelected(created.id);
      await loadSessions();
    } catch (error) {
      setFailed(word(error));
    }
  }

  return (
    <>
      <PageHeader
        title={name || t('title')}
        description={t('sessionsHelp')}
        action={<Button asChild variant="outline" size="sm"><Link to={`/teams/${team.id}/shared-hosts`}>{t('back')}</Link></Button>}
      />
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      <PinGate computerId={computerId} state={pin} />
      {!pinPrompt(pin, false) && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card className="h-fit">
            <CardContent className="flex flex-col gap-2 pt-6 text-sm">
              <Button size="sm" onClick={() => void start()}>{t('newSession')}</Button>
              {sessions?.length === 0 && <p className="text-muted-foreground">{t('noSessions')}</p>}
              {sessions?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={`flex flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent ${selected === s.id ? 'bg-accent' : ''}`}
                >
                  <span className="flex w-full items-center gap-2 font-medium">
                    {s.pending && <span aria-label={t('waiting')} className="size-1.5 shrink-0 rounded-full bg-signal" />}
                    <span className="truncate">{s.title || t('untitled')}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.status === 'running' ? t('running') : format.relativeTime(new Date(s.updatedAt))} · {s.directory}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
          {selected ? <Conversation key={selected} computerId={computerId} sessionId={selected} /> : <p className="text-sm text-muted-foreground">{t('pick')}</p>}
        </div>
      )}
    </>
  );
}

function Conversation({ computerId, sessionId }: { computerId: string; sessionId: string }) {
  const { me } = useTeam();
  const t = useTranslations('team.sharedDsh');
  const word = useRelayError();
  const relay = relayFor(me);
  const [state, setState] = useState<SessionState>(EMPTY_SESSION);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => relay.follow(computerId, sessionId, (event) => setState((s) => applySessionEvent(s, event))), [relay, computerId, sessionId]);

  const rows = rowsOf(state.items);
  const running = state.status === 'running';
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setFailed(null);
    try {
      await run();
    } catch (error) {
      setFailed(word(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6 text-sm">
        {rows.map((row) =>
          row.kind === 'user' ? (
            <p key={row.id} className="ml-auto max-w-[80%] rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap">{row.text}</p>
          ) : row.kind === 'assistant' ? (
            <div key={row.id} className="flex flex-col gap-2 leading-6 [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>{row.text}</Markdown>
            </div>
          ) : (
            <details key={row.id} className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              <summary>{t('steps', { count: row.tools.length })}{row.status === 'running' ? ` · ${t('running')}` : row.status === 'done' ? '' : ` · ${t(row.status)}`}</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {row.tools.map((tool) => <li key={tool.id} className="truncate font-mono">{tool.name} {tool.summary}</li>)}
              </ul>
            </details>
          ),
        )}
        {isThinking(rows, running) && <p className="text-muted-foreground">{t('thinking')}</p>}
        {state.pending?.kind === 'question' && (
          <div className="flex flex-col gap-2 border-l-[3px] border-signal pl-3">
            <p className="font-medium">{state.pending.question}</p>
            <div className="flex flex-wrap gap-2">
              {state.pending.options.map((option) => (
                <Button key={option.id} size="sm" variant="outline" disabled={busy} onClick={() => void act(() => relay.answer(computerId, sessionId, state.pending!.id, { kind: 'question', optionId: option.id }))}>
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        {state.pending?.kind === 'approval' && (
          <div className="flex flex-col gap-2 border-l-[3px] border-signal pl-3">
            <p className="font-medium">{state.pending.title}</p>
            {state.pending.detail && <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{state.pending.detail}</pre>}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void act(() => relay.answer(computerId, sessionId, state.pending!.id, { kind: 'approval', approve: true }))}>{t('allow')}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => relay.answer(computerId, sessionId, state.pending!.id, { kind: 'approval', approve: false }))}>{t('deny')}</Button>
            </div>
          </div>
        )}
        {state.closed && <p role="alert" className="text-destructive">{word(new RelayError(state.closed))}</p>}
        {failed && <p role="alert" className="text-destructive">{failed}</p>}
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const message = text.trim();
            if (message) void act(async () => { await relay.prompt(computerId, sessionId, message); setText(''); });
          }}
        >
          <Textarea value={text} rows={3} placeholder={t('promptPlaceholder')} onChange={(event) => setText(event.target.value)} />
          <div className="flex justify-end gap-2">
            {running && <Button type="button" variant="outline" disabled={busy} onClick={() => void act(() => relay.cancel(computerId, sessionId))}>{t('stop')}</Button>}
            <Button type="submit" disabled={busy || running || !!state.pending || !text.trim()}>{t('send')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** The DSH asks for this member's PIN: set a first one, typed twice, or give it. Only the DSH checks it. */
function PinGate({ computerId, state }: { computerId: string; state: PinState | undefined }) {
  const { me } = useTeam();
  const t = useTranslations('team.sharedDsh.pin');
  const relay = relayFor(me);
  const [value, setValue] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'mismatch' | 'unavailable' | null>(null);
  const prompt = pinPrompt(state, first !== null);
  if (!prompt) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (value.length !== 4 || busy) return;
    if (prompt === 'set') { setFirst(value); setValue(''); return; }
    if (prompt === 'confirm' && value !== first) { setFirst(null); setValue(''); setFailed('mismatch'); return; }
    setBusy(true);
    setFailed(null);
    try {
      if (prompt === 'confirm') await relay.setPin(computerId, value);
      else await relay.unlock(computerId, value);
    } catch {
      setFailed('unavailable');
    } finally {
      setBusy(false);
      setValue('');
      setFirst(null);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t(`${prompt}.title`)}</CardTitle>
        <CardDescription>{state?.kind === 'wrong' ? t('wrong', { count: state.left }) : t(`${prompt}.hint`)}</CardDescription>
      </CardHeader>
      {prompt !== 'locked' && (
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
            <Input
              aria-label={t(`${prompt}.title`)}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={4}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 4))}
              className="text-center font-mono text-2xl tracking-[0.5em]"
            />
            {failed && <p role="alert" className="text-sm text-destructive">{t(failed)}</p>}
            <Button type="submit" disabled={busy || value.length !== 4}>{t('submit')}</Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
