/**
 * My DSH (`/teams/{teamId}/my-dsh[/{hostId}[/{sessionId}]]`, docs/tech/relay.md, "My DSH in the web console"): the
 * member's own computers, the same in every team, in Workspace. The second column lists them, with the member's
 * sessions beneath the one open once this browser is paired with it; the third pairs this browser (the code from the
 * computer's Teamwork panel, then the safety code), asks for the computer's PIN, and holds the conversation. Each
 * computer's devices, every phone and browser of the member's paired with it, are listed and removable here (ADR
 * 0048). The computer's id in the address is its host id; the relay is spoken to through this browser's pairing.
 */

import { Check, Laptop, Loader, Monitor, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import { normalizePairingCode, PAIRING_CODE_LENGTH, RelayError, type Pairing } from '@dsh-teamwork/relay-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { browserCanJoin, myComputers, relayFor, removeDevice, type MyComputer } from '@/lib/relay';

import { ComputerRow, Conversation, DshColumns, NewSession, PinGate, SessionList, useComputer, useRelayError } from './dsh-session';
import { useTeam } from './layout';

/** The member's own computers and their sessions on the one open, beside the conversation. */
export function MyDshPage() {
  const { team, me } = useTeam();
  const { hostId = '', sessionId = '' } = useParams();
  const t = useTranslations('team.myDsh');
  const tt = useTranslations('team.dsh');
  const format = useFormatter();
  const navigate = useNavigate();
  const base = `/teams/${team.id}/my-dsh`;
  const [hosts, setHosts] = useState<MyComputer[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHosts(await myComputers(me));
      setFailed(null);
    } catch {
      setFailed(t('loadFailed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` is stable for a locale.
  }, [me]);
  useEffect(() => void load(), [load]);

  const host = hosts?.find((h) => h.id === hostId);
  // The relay is spoken to through this browser's own confirmed pairing with the computer.
  const computerId = host?.pairings.find((p) => p.current && p.status === 'confirmed')?.id ?? '';
  const { sessions, pin, failed: unreachable, reload, locked } = useComputer(computerId);
  const session = sessions?.find((s) => s.id === sessionId);
  const note = (h: MyComputer) => (h.online ? tt('online') : t('lastSeen', { time: format.relativeTime(new Date(h.lastSeenAt), new Date()) }));
  const problem = failed ?? unreachable;

  return (
    <DshColumns
      title={t('title')}
      list={(onPick) => (
        <>
          {hosts?.length === 0 && <p className="px-2.5 text-muted-foreground">{t('none')}</p>}
          {hosts?.map((h) => {
            const open = h.id === hostId;
            return (
              <div key={h.id} className="flex flex-col gap-0.5">
                <ComputerRow icon={Laptop} name={h.name} note={note(h)} online={h.online} to={`${base}/${h.id}`} open={open} current={open && !sessionId} onPick={onPick} />
                {open && computerId && <SessionList base={`${base}/${h.id}`} locked={locked} sessions={sessions} sessionId={sessionId} onPick={onPick} />}
              </div>
            );
          })}
        </>
      )}
    >
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {!host ? (
        <section className="m-auto flex max-w-lg flex-col items-center gap-3 py-10 text-center">
          <Laptop className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">{t('introTitle')}</h2>
          <p className="text-sm text-muted-foreground">{hosts?.length === 0 ? t('none') : t('intro')}</p>
        </section>
      ) : sessionId && computerId && !locked ? (
        <Conversation key={sessionId} computerId={computerId} sessionId={sessionId} title={session?.title || tt('untitled')} />
      ) : (
        <>
          <HostHeader host={host} note={note(host)} changed={() => void load()} />
          {!computerId ? (
            <Pair host={host} paired={() => void load()} />
          ) : locked ? (
            <PinGate computerId={computerId} state={pin} lockedHint={t('lockedHint')} />
          ) : (
            <NewSession key={computerId} computerId={computerId} name={host.name} started={(id) => { void reload(); navigate(`${base}/${host.id}/${id}`); }} />
          )}
        </>
      )}
    </DshColumns>
  );
}

/** The open computer: its name, state and version, and its devices, folded until asked for. */
function HostHeader({ host, note, changed }: { host: MyComputer; note: string; changed: () => void }) {
  const t = useTranslations('team.myDsh');
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{host.name}</h2>
        <span className="text-xs text-muted-foreground">
          {note}
          {host.dshVersion && ` · ${t('version', { version: host.dshVersion })}`}
        </span>
      </div>
      <details className="group rounded-lg border text-sm">
        <summary className="flex list-none items-center justify-between gap-3 px-4 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
          <span>{t('devices')}</span>
          <span className="text-xs font-normal text-muted-foreground">{host.pairings.length}</span>
        </summary>
        <Devices host={host} changed={changed} />
      </details>
    </header>
  );
}

/** Every phone and browser of the member's paired with the computer, each removable (ADR 0048). */
function Devices({ host, changed }: { host: MyComputer; changed: () => void }) {
  const { me } = useTeam();
  const t = useTranslations('team.myDsh');
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  async function remove(device: MyComputer['pairings'][number]) {
    if (!confirm(t('revokeConfirm', { device: device.deviceName, name: host.name }))) return;
    setBusy(true);
    try {
      // This browser's own pairing tells the desktop first; any other goes through the relay alone.
      if (device.current) await relayFor(me).revokeComputer(device.id);
      else await removeDevice(device.id);
      toast.success(t('revoked'));
      changed();
    } catch {
      toast.error(t('revokeFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-1 border-t px-4 py-3">
      <p className="pb-1 text-xs text-muted-foreground">{t('devicesHelp', { name: host.name })}</p>
      {host.pairings.length === 0 && <p className="text-muted-foreground">{t('noDevices')}</p>}
      <ul className="flex flex-col">
        {host.pairings.map((device) => {
          const Icon = device.current ? Monitor : Smartphone;
          return (
            <li key={device.id} className="flex items-center gap-3 border-b py-2 last:border-b-0">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {device.deviceName}
                  {device.current && <span className="ml-2 text-xs text-muted-foreground">{t('thisBrowser')}</span>}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    device.status === 'pending' ? t('pending') : null,
                    device.lastUsedAt ? t('lastUsed', { time: format.relativeTime(new Date(device.lastUsedAt), new Date()) }) : t('neverUsed'),
                    device.push ? t('push') : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove(device)}>{t('revoke')}</Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pairs this browser with the computer as the phone app pairs (docs/tech/relay.md, "Pairing"): the code its Teamwork
 * panel shows, then the safety code both screens show, compared by the member, then the desktop's approval.
 */
function Pair({ host, paired }: { host: MyComputer; paired: () => void }) {
  const { me } = useTeam();
  const t = useTranslations('team.myDsh');
  const word = useRelayError();
  const relay = relayFor(me);
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [matched, setMatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const pending = pairing?.status === 'pending' ? pairing.id : null;

  // While the pairing waits, read it again: its safety code arrives, then the desktop's answer.
  useEffect(() => {
    if (!pending) return;
    let live = true;
    const check = async () => {
      try {
        const next = await relay.getPairing(pending);
        if (!live) return;
        if (!next) {
          setPairing(null);
          setMatched(false);
          setFailed(t('refused'));
        } else {
          setPairing(next);
          if (next.status === 'confirmed') paired();
        }
      } catch (error) {
        if (live) setFailed(word(error));
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t`, `word` and `paired` are fresh closures each render.
  }, [relay, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || code.length !== PAIRING_CODE_LENGTH) return;
    if (!(await browserCanJoin())) return setFailed(t('browserUnsupported'));
    setBusy(true);
    setFailed(null);
    try {
      setPairing(await relay.pair(code, t('deviceName')));
    } catch (error) {
      setFailed(error instanceof RelayError && error.code === 'not_found' ? t('invalidCode') : word(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMatch(id: string) {
    try {
      await relay.confirmPairing(id);
      setMatched(true);
    } catch (error) {
      setFailed(word(error));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-4 py-6">
      {!pairing ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <h3 className="font-semibold">{t('pairTitle', { name: host.name })}</h3>
          <p className="text-sm text-muted-foreground">{t('pairHelp')}</p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('code')}
            <Input
              value={code}
              autoFocus
              autoComplete="one-time-code"
              maxLength={PAIRING_CODE_LENGTH}
              className="text-center font-mono text-2xl tracking-[0.4em] uppercase"
              onChange={(event) => setCode(normalizePairingCode(event.target.value))}
            />
          </label>
          <Button type="submit" disabled={busy || code.length !== PAIRING_CODE_LENGTH}>{busy ? t('pairing') : t('pair')}</Button>
        </form>
      ) : pairing.safetyCode ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <h3 className="font-semibold">{t('safetyTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('safetyHelp')}</p>
          <p className="font-mono text-3xl tracking-widest select-all">{pairing.safetyCode}</p>
          {matched ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader className="size-4 animate-spin" aria-hidden />
              {t('waitingApproval')}
            </p>
          ) : (
            <Button onClick={() => void confirmMatch(pairing.id)}>
              <Check className="size-4" aria-hidden />
              {t('matches')}
            </Button>
          )}
        </div>
      ) : (
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden />
          {t('pairing')}
        </p>
      )}
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
    </section>
  );
}
