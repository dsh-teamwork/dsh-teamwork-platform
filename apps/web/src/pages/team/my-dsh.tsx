/**
 * My DSH (`/teams/{teamId}/my-dsh[/{hostId}[/{sessionId}]]`, docs/tech/relay.md, "My DSH in the web console"): the
 * member's own computers, the same in every team, in Workspace. The computers fold out under My DSH in the console's
 * sidebar (`MyDshNav` in console-shell.tsx); the page is the one open. Its column beside the sidebar names it, opens its
 * settings (`/teams/{teamId}/my-dsh/{hostId}/settings`: its name, its native DSH Web, every phone and browser of the
 * member's paired with it, each removable, ADR 0048, and removing the computer), and lists its sessions once this
 * browser is paired with it, grouped as DSH's own sidebar groups them. The column beside that pairs this browser (the code from the
 * computer's Teamwork panel, then the safety code), asks for the computer's PIN, and holds the conversation. An offline
 * computer can be removed itself, with every device paired to it. The computer's id in the address is its host id; the
 * relay is spoken to through this browser's pairing. With no computer in the address the page opens the one this
 * browser opened last, else the first online, else the first.
 *
 * The alarm clock beside the settings button opens the computer's automation tasks in the right column
 * (`/teams/{teamId}/my-dsh/{hostId}/tasks[/{taskId}]`, docs/tech/automation-tasks.md).
 *
 * The right column follows the computer's state, one at a time: offline (nothing else is possible), online but not
 * paired with this browser (pair), paired and connecting (its encrypted channel and PIN state not heard yet), the
 * channel failed (retry), its PIN asked (the gate), and only then a session, or a new one with the composer centred;
 * until then the column of sessions says which. The list of computers is read again every few seconds, so a computer
 * coming online or going away moves the page along by itself.
 */

import { AlarmClock, ArrowLeft, Check, ExternalLink, Laptop, Loader, Monitor, MonitorSmartphone, RotateCw, Settings, ShieldCheck, Smartphone, Trash2, WifiOff, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import { HOST_OS_NAMES, normalizePairingCode, PAIRING_CODE_LENGTH, RelayError, type Pairing } from '@dsh-teamwork/relay-client';
import { twinOf } from '@/components/team/console-shell';
import { Button } from '@/components/ui/button';
import { CodePrompt, CodeSlots } from '@/components/ui/code-entry';
import { Input } from '@/components/ui/input';
import { browserCanJoin, desktopWebAddress, myComputers, relayFor, removeComputer, removeDevice, renameComputer, useComputersChanged, type MyComputer } from '@/lib/relay';
import { cn } from '@/lib/utils';

import { SignInSteps } from './connect-dsh';
import { Conversation, DshColumns, PinGate, Presence, SessionList, useComputer, useRelayError } from './dsh-session';
import { TasksPanel } from './dsh-tasks';
import { useTeam } from './layout';

/** Where this browser keeps the computer it opened last, for My DSH opened with none in the address. */
const LAST_KEY = 'dsh-teamwork:my-dsh:last';

/**
 * One computer of the member's: its sessions in the column, beside the conversation or, with `settings`, its settings,
 * or with `tasks`, its automation tasks (dsh-tasks.tsx).
 */
export function MyDshPage({ settings = false, tasks = false }: { settings?: boolean; tasks?: boolean }) {
  const { team, me } = useTeam();
  const { hostId = '', sessionId = '', taskId = '' } = useParams();
  const t = useTranslations('team.myDsh');
  const tt = useTranslations('team.dsh');
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
  // Whether each computer is online changes on its own: read the list again when one comes or goes.
  useComputersChanged(me, load);

  const host = hosts?.find((h) => h.id === hostId);
  // No computer in the address: open the one opened here last, else the first online, else the first.
  useEffect(() => {
    if (hostId || !hosts?.length) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_KEY);
    } catch {
      // A browser that keeps nothing opens the first online.
    }
    const pick = hosts.find((h) => h.id === last) ?? hosts.find((h) => h.online) ?? hosts[0]!;
    navigate(`${base}/${pick.id}`, { replace: true });
  }, [hostId, hosts, base, navigate]);
  useEffect(() => {
    if (!host) return;
    try {
      localStorage.setItem(LAST_KEY, host.id);
    } catch {
      // Nothing to remember it in.
    }
  }, [host]);

  // This browser's own confirmed pairing with the computer; the relay is spoken to through it, and only while the
  // computer is online, since nothing on the other side could answer otherwise.
  const paired = host?.pairings.find((p) => p.current && p.status === 'confirmed')?.id ?? '';
  const computerId = host?.online ? paired : '';
  const { sessions, pin, failed: unreachable, reload, locked } = useComputer(computerId);
  // The relay saying the computer cannot be reached is news the list may not have yet: read it again now.
  useEffect(() => {
    if (unreachable) void load();
  }, [unreachable, load]);
  // Ready once the computer answered: its sessions read, or its PIN state says unlocked. Until then it is connecting.
  const ready = computerId !== '' && !locked && (sessions !== null || pin?.kind === 'unlocked');
  const session = sessions?.find((s) => s.id === sessionId);
  const twin = host ? twinOf(hosts ?? [], host) : null;
  // Why the column lists no sessions yet; the right column says what to do about it.
  const unavailable = !host
    ? undefined
    : !host.online
      ? t('offlineList')
      : !computerId
        ? t('pairList')
        : locked
          ? tt('locked')
          : unreachable
            ? t('unreachableList')
            : !ready
              ? t('connectingList')
              : undefined;

  // No computer has signed in yet: no column of sessions, only how to sign one in, the same steps as Home's
  // (./connect-dsh.tsx). The list is read again meanwhile, so the page opens the computer once it signs in.
  if (hosts?.length === 0) {
    return (
      <section className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-10 md:py-16">
        {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        <Laptop className="size-8 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{t('introTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        </div>
        <SignInSteps />
      </section>
    );
  }

  return (
    <DshColumns
      header={host ? <ColumnHeader host={host} twin={twin} paired={paired !== ''} settings={settings} tasks={unavailable ? null : tasks} base={base} /> : <h1 className="truncate text-lg font-semibold tracking-tight">{t('title')}</h1>}
      list={(onPick) =>
        host ? (
          <SessionList computerId={computerId} base={`${base}/${host.id}`} unavailable={unavailable} sessions={sessions} sessionId={settings || tasks ? '' : sessionId} onPick={onPick} />
        ) : null
      }
    >
      {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
      {!host ? (
        <section className="m-auto flex max-w-lg flex-col items-center gap-3 py-10 text-center">
          <Laptop className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">{t('introTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </section>
      ) : settings ? (
        <SettingsView
          host={host}
          back={`${base}/${host.id}`}
          changed={() => void load()}
          removed={() => {
            void load();
            navigate(base);
          }}
        />
      ) : ready && !unreachable && tasks ? (
        <TasksPanel computerId={computerId} base={`${base}/${host.id}/tasks`} sessionsBase={`${base}/${host.id}`} taskId={taskId} sessions={sessions} />
      ) : ready && !unreachable ? (
        <Conversation
          key={computerId}
          computerId={computerId}
          sessionId={sessionId}
          title={session?.title || tt('untitled')}
          name={host.name}
          tasks={`${base}/${host.id}/tasks`}
          started={(id) => { void reload(); navigate(`${base}/${host.id}/${id}`); }}
        />
      ) : (
        <>
          <HostHeader host={host} twin={twin} />
          {!host.online ? (
            <State icon={WifiOff} title={t('offlineTitle', { name: host.name })} body={t(paired ? 'offlineHelp' : 'offlineUnpairedHelp')}>
              <RemoveComputer
                host={host}
                removed={() => {
                  void load();
                  navigate(base);
                }}
              />
            </State>
          ) : !computerId ? (
            <Pair
              host={host}
              paired={(pairedHost) => {
                void load();
                // The code may have come from another record of the member's (one with the same name): open that one.
                if (pairedHost && pairedHost !== host.id) navigate(`${base}/${pairedHost}`);
              }}
            />
          ) : locked ? (
            <PinGate computerId={computerId} state={pin} lockedHint={t('lockedHint')} />
          ) : unreachable ? (
            <State icon={WifiOff} title={t('unreachableTitle', { name: host.name })} body={unreachable}>
              <Button variant="outline" onClick={() => void reload()}>
                <RotateCw className="size-4" aria-hidden />
                {t('retry')}
              </Button>
            </State>
          ) : (
            <State icon={Loader} spin title={t('connecting', { name: host.name })} body={t('connectingHelp')} />
          )}
        </>
      )}
    </DshColumns>
  );
}

/** One of the square buttons at the end of the column's header; `open` marks the page it opens as the one shown. */
const headerButton = (open: boolean) => cn(
  'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  open && 'border-brand text-foreground',
);

/**
 * The open computer atop its column of sessions: its name, and under it whether it is online, its system and whether
 * this browser is paired with it; at its end, its automation tasks while the computer can be reached (`tasks` null
 * otherwise, true while they are shown) and its settings.
 */
function ColumnHeader({ host, twin, paired, settings, tasks, base }: { host: MyComputer; twin: string | null; paired: boolean; settings: boolean; tasks: boolean | null; base: string }) {
  const t = useTranslations('team.myDsh');
  const tt = useTranslations('team.tasks');
  const note = [host.os ? HOST_OS_NAMES[host.os] : null, paired ? null : t('notPairedShort')].filter(Boolean).join(' · ');
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="flex min-w-0 items-baseline gap-1.5 text-lg font-semibold tracking-tight">
          <span className="truncate">{host.name}</span>
          {twin && <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">{twin}</span>}
        </h1>
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Presence online={host.online} />
          {note && <span aria-hidden>·</span>}
          {note && <span className="truncate">{note}</span>}
        </p>
      </div>
      {tasks !== null && (
        <Link
          to={tasks ? `${base}/${host.id}` : `${base}/${host.id}/tasks`}
          aria-label={tt('title')}
          title={tt('title')}
          aria-current={tasks ? 'page' : undefined}
          className={headerButton(tasks)}
        >
          <AlarmClock className="size-4" aria-hidden />
        </Link>
      )}
      <Link
        to={settings ? `${base}/${host.id}` : `${base}/${host.id}/settings`}
        aria-label={t('settings')}
        title={t('settings')}
        aria-current={settings ? 'page' : undefined}
        className={headerButton(settings)}
      >
        <Settings className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Opens the computer's native DSH Web in a new tab through a one-time ticket (platform ADR 0064). The tab opens on the
 * click itself, since a browser blocks one opened after the ticket's request; it is pointed at the ticket once it
 * comes, without a way back to this page, and closed if none does.
 */
function OpenNativeWeb({ host, returnTo }: { host: MyComputer; returnTo: string }) {
  const t = useTranslations('team.myDsh');
  const [opening, setOpening] = useState(false);
  async function open() {
    setOpening(true);
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const address = await desktopWebAddress(host.id, returnTo);
      if (tab) tab.location.replace(address);
      else window.location.assign(address);
    } catch {
      tab?.close();
      toast.error(t('openWebFailed'));
    } finally {
      setOpening(false);
    }
  }
  return (
    <Button variant="outline" disabled={opening} onClick={() => void open()}>
      <ExternalLink className="size-4" aria-hidden />
      {t('openWeb')}
    </Button>
  );
}

/** A state of the open computer in which nothing can be done here but wait, or what `children` offers. */
function State({ icon: Icon, spin, title, body, children }: { icon: LucideIcon; spin?: boolean; title: string; body: string; children?: ReactNode }) {
  return (
    <section role="status" className="m-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
      <Icon className={cn('size-8 text-muted-foreground', spin && 'animate-spin')} aria-hidden />
      <h3 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}

/**
 * Signs a computer out and forgets it with every device paired to it, connected or not (ADR 0060): one lost or no
 * longer used, or a record left by signing in again.
 */
function RemoveComputer({ host, removed }: { host: MyComputer; removed: () => void }) {
  const { me } = useTeam();
  const t = useTranslations('team.myDsh');
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!confirm(t('removeComputerConfirm', { name: host.name }))) return;
    setBusy(true);
    try {
      await removeComputer(me, host);
      toast.success(t('computerRemoved'));
      removed();
    } catch {
      toast.error(t('removeComputerFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void remove()}>
      <Trash2 className="size-4" aria-hidden />
      {t('removeComputer')}
    </Button>
  );
}

/** The open computer: its name, and under it its system and DSH, on the left; whether it is online on the right. */
function HostHeader({ host, twin }: { host: MyComputer; twin: string | null }) {
  const t = useTranslations('team.myDsh');
  const format = useFormatter();
  const facts = [
    host.os ? HOST_OS_NAMES[host.os] : null,
    host.dshVersion ? t('version', { version: host.dshVersion }) : null,
    host.pluginVersion ? t('pluginVersion', { version: host.pluginVersion }) : null,
    twin,
  ].filter(Boolean);
  return (
    <header className="flex items-start justify-between gap-4 border-b pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{host.name}</h2>
        {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p>}
      </div>
      <span className={cn('mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', host.online ? 'bg-success/10' : 'bg-muted')}>
        <Presence
          online={host.online}
          label={host.online ? undefined : t('lastSeenShort', { time: format.relativeTime(new Date(host.lastSeenAt), new Date()) })}
        />
      </span>
    </header>
  );
}

/**
 * The computer's settings: its name, its native DSH Web while it offers it, every phone and browser of the member's
 * paired with it, each removable (ADR 0048), and the computer itself, which removing signs out of Teamwork (ADR 0060).
 */
function SettingsView({ host, back, changed, removed }: { host: MyComputer; back: string; changed: () => void; removed: () => void }) {
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
    <div className="flex flex-col gap-4 text-sm">
      <header className="flex flex-col gap-1.5">
        <Link to={back} className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />
          <span className="[overflow-wrap:anywhere]">{host.name}</span>
        </Link>
        <h2 className="text-xl font-semibold tracking-tight">{t('settings')}</h2>
      </header>
      <Rename host={host} renamed={changed} />
      <section className="flex flex-col items-start gap-2 border-t pt-4">
        <h3 className="font-semibold">{t('webTitle')}</h3>
        <p className="text-muted-foreground">{host.webOnline ? t('webHelp') : t('webOff')}</p>
        {host.webOnline && <OpenNativeWeb host={host} returnTo={back} />}
      </section>
      <header className="flex flex-col gap-1 border-t pt-4">
        <h3 className="font-semibold">{t('devicesTitle')}</h3>
        <p className="text-muted-foreground">{t('devicesHelp')}</p>
      </header>
      {host.pairings.length === 0 && <p className="text-muted-foreground">{t('noDevices')}</p>}
      <ul className="flex flex-col rounded-lg border px-4 empty:hidden">
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
      <section className="flex flex-col items-start gap-2 border-t pt-4">
        <p className="text-muted-foreground">{t('removeComputerHelp')}</p>
        <RemoveComputer host={host} removed={removed} />
      </section>
    </div>
  );
}

/** The computer's name, as the console, the phones and native DSH Web's bar show it; it holds when it reconnects. */
function Rename({ host, renamed }: { host: MyComputer; renamed: () => void }) {
  const t = useTranslations('team.myDsh');
  const [name, setName] = useState(host.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(host.name), [host.name]);
  const next = name.trim();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await renameComputer(host.id, next);
      toast.success(t('renamed'));
      renamed();
    } catch {
      toast.error(t('renameFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
      <label htmlFor="computer-name" className="font-semibold">{t('nameLabel')}</label>
      <div className="flex max-w-md gap-2">
        <Input id="computer-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || next === '' || next === host.name}>{t('saveName')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('nameHelp')}</p>
    </form>
  );
}

/**
 * Pairs this browser with the computer as the phone app pairs (docs/tech/relay.md, "Pairing"): the code its Teamwork
 * panel shows, then the safety code both screens show, compared by the member, then the desktop's approval.
 */
function Pair({ host, paired }: { host: MyComputer; paired: (hostId: string | undefined) => void }) {
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
        if (!next || next.verificationError) {
          // Refused, or the encrypted channel to the computer failed before it accepted: start again with a new code.
          setPairing(null);
          setMatched(false);
          setCode('');
          setFailed(t(next ? 'pairFailed' : 'refused'));
        } else {
          setPairing(next);
          if (next.status === 'confirmed') paired((await relay.listComputers()).find((c) => c.id === next.id)?.hostId);
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

  // A full code is sent at once, as the phone app does; the button sends it again after a failure.
  async function submit(value: string) {
    if (busy || value.length !== PAIRING_CODE_LENGTH) return;
    if (!(await browserCanJoin())) return setFailed(t('browserUnsupported'));
    setBusy(true);
    setFailed(null);
    try {
      setPairing(await relay.pair(value, t('deviceName')));
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

  const error = failed && <p role="alert" className="text-sm text-destructive">{failed}</p>;
  if (!pairing)
    return (
      <CodePrompt icon={MonitorSmartphone} title={t('pairTitle', { name: host.name })} hint={t('pairHelp')}>
        <form
          className="flex w-full flex-col items-center gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(code);
          }}
        >
          <CodeSlots
            label={t('code')}
            length={PAIRING_CODE_LENGTH}
            // The panel shows the code in two halves ("PQP WGG"): the boxes split where it does.
            group={PAIRING_CODE_LENGTH / 2}
            value={code}
            disabled={busy}
            // The space a pasted code keeps goes first, then the length is held.
            onChange={(raw) => {
              const next = normalizePairingCode(raw).slice(0, PAIRING_CODE_LENGTH);
              setCode(next);
              setFailed(null);
              if (next.length === PAIRING_CODE_LENGTH && next !== code) void submit(next);
            }}
          />
          {error}
          <Button type="submit" className="h-11 w-full" disabled={busy || code.length !== PAIRING_CODE_LENGTH}>
            {busy && <Loader className="size-4 animate-spin" aria-hidden />}
            {busy ? t('pairing') : t('pair')}
          </Button>
        </form>
      </CodePrompt>
    );
  if (!pairing.safetyCode)
    return (
      <CodePrompt icon={MonitorSmartphone} title={t('pairTitle', { name: host.name })} hint={t('connectingHelp')}>
        <Loader className="size-5 animate-spin text-muted-foreground" role="status" aria-label={t('pairing')} />
        {error}
      </CodePrompt>
    );
  return (
    <CodePrompt icon={ShieldCheck} title={t('safetyTitle')} hint={t('safetyHelp')}>
      <div className="flex w-full flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs">
        <p className="font-mono text-3xl font-semibold tracking-widest select-all">{pairing.safetyCode}</p>
        {matched ? (
          <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden />
            {t('waitingApproval')}
          </p>
        ) : (
          <Button className="h-11" onClick={() => void confirmMatch(pairing.id)}>
            <Check className="size-4" aria-hidden />
            {t('matches')}
          </Button>
        )}
      </div>
      {error}
    </CodePrompt>
  );
}
