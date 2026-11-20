import { editionSecurity } from '@/lib/edition';
/**
 * `/account`: the account settings, where every way to the account leads
 * (components/account.tsx). One page in sections divided by hairlines, after
 * Router9 Studio's settings: who you are (the name, edited in place, and the
 * email), preferences (language and theme), the password where the instance
 * holds passwords, your teams, signing out, and deleting the account
 * (docs/adr/0039-deleting-an-account.md).
 */

import { Check, LogOut, Moon, Pencil, Sun, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { Avatar } from '@/components/account';
import { LocalePicker } from '@/components/locale-picker';
import { Failure, useTitle } from '@/components/page';
import { SiteFrame } from '@/components/site-frame';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type TeamSummary } from '@/lib/api';
import { authError, type AuthError } from '@/lib/auth-error';
import { useSession } from '@/lib/session';
import { readTheme, setTheme, subscribeTheme, type Theme } from '@/lib/theme';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

const PASSWORD_MIN = 10;

export function AccountPage() {
  const Security = editionSecurity()?.account;
  const t = useTranslations('account');
  useTitle(t('title'));
  const { session } = useSession();
  const user = session.user;
  const teams = useApi<TeamSummary[]>(user ? 'teams' : null);
  if (!user) return null; // RequireUser sends a stranger to sign in

  return (
    <SiteFrame>
      <div className="mx-auto flex w-full max-w-3xl flex-col">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
        <Identity name={user.name} email={user.email} />
        <Section title={t('preferences')}>
          <Row label={t('language')}>
            <LocalePicker className="min-w-40" />
          </Row>
          <Row label={t('theme')}>
            <ThemeChoice />
          </Row>
        </Section>
        {Security && <Security />}
        {session.doors.password && <PasswordSection />}
        <TeamsSection teams={teams.data} />
        <Section title={t('session')} description={t('sessionHint')} action={<SignOut />} />
        {teams.data && <DeleteSection email={user.email} teams={teams.data} />}
      </div>
    </SiteFrame>
  );
}

/** One part of the page: a heading, perhaps a line under it, then its rows; the hairline above it divides it from the last. */
function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

/** The avatar, the name (click to change it; Enter or leaving the field saves, Escape cancels) and the email. */
function Identity({ name, email }: { name: string | null; email: string | null }) {
  const t = useTranslations('account');
  const { refresh } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if (next === (name ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      // An empty name clears it: the avatar and the rows fall back to the email.
      await api('profile', { method: 'PATCH', body: { name: next || null } });
      await refresh();
      toast.success(t('nameSaved'));
      setEditing(false);
    } catch {
      toast.error(t('nameFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-5 py-8">
      <Avatar name={name} email={email} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            maxLength={80}
            disabled={saving}
            aria-label={t('name')}
            placeholder={t('namePlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-9 max-w-sm text-lg font-semibold"
          />
        ) : (
          <button
            type="button"
            title={t('editName')}
            onClick={() => {
              setDraft(name ?? '');
              setEditing(true);
            }}
            className="group -ml-2 flex max-w-full items-center gap-2 self-start rounded-md px-2 py-1 text-left hover:bg-accent"
          >
            <span className={cn('truncate text-xl font-semibold', !name && 'text-muted-foreground')}>{name || t('noName')}</span>
            <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
          </button>
        )}
        <span className="truncate text-sm text-muted-foreground">{email}</span>
      </div>
    </div>
  );
}

/** Light or dark, as two segments; the one in force is filled. */
function ThemeChoice() {
  const t = useTranslations('account');
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const options: { value: Theme; icon: typeof Sun }[] = [
    { value: 'light', icon: Sun },
    { value: 'dark', icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label={t('theme')} className="flex rounded-md border">
      {options.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-1.5 text-sm first:rounded-l-md last:rounded-r-md',
            theme === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {t(`themes.${value}`)}
        </button>
      ))}
    </div>
  );
}

function PasswordSection() {
  const t = useTranslations('account');
  const tp = useTranslations('password');
  const te = useTranslations('authErrors');
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <Section title={t('password')} description={t('passwordHint')}>
      <form
        className="grid max-w-md gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setDone(false);
          setPending(true);
          try {
            await api('auth/password/change', { body: { current, next: replacement } });
            setCurrent('');
            setReplacement('');
            setDone(true);
            toast.success(t('passwordChanged'));
          } catch (failure) {
            setError(authError(failure));
          } finally {
            setPending(false);
          }
        }}
      >
        <Label htmlFor="current-password">{tp('current')}</Label>
        <Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Label htmlFor="new-password">{tp('next')}</Label>
        <Input id="new-password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <p className="text-xs text-muted-foreground">{tp('hint')}</p>
        <Failure message={error && te(error)} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {t('passwordSubmit')}
          </Button>
          {done && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Check className="size-4" aria-hidden />
              {t('passwordChanged')}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

/** The teams the person is in and their role in each, as rows to open. */
function TeamsSection({ teams }: { teams: TeamSummary[] | undefined }) {
  const t = useTranslations('account');
  const tt = useTranslations('team');
  return (
    <Section
      title={t('teams')}
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/teams">{t('allTeams')}</Link>
        </Button>
      }
    >
      {teams && teams.length === 0 && <p className="text-sm text-muted-foreground">{t('noTeams')}</p>}
      {teams && teams.length > 0 && (
        <ul className="overflow-hidden rounded-lg border">
          {teams.map((team) => (
            <li key={team.id} className="border-t first:border-t-0">
              <Link to={`/teams/${team.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent">
                <span className="min-w-0 flex-1 truncate font-medium">{team.name}</span>
                <span className="text-xs text-muted-foreground">{tt('list.members', { count: team.memberCount })}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', team.role === 'admin' ? 'bg-brand text-brand-foreground' : 'bg-secondary text-muted-foreground')}>
                  {tt(`role.${team.role}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SignOut() {
  const tc = useTranslations('common');
  const { signOut } = useSession();
  return (
    <Button variant="outline" onClick={() => void signOut()}>
      <LogOut />
      {tc('signOut')}
    </Button>
  );
}

/**
 * Deleting the account. A team the person administers with others in it
 * blocks it, listed with a way to its members page to hand the role over; a
 * team they are alone in goes with the account, and the dialog names it. The
 * email typed back is the confirmation the server checks too.
 */
function DeleteSection({ email, teams }: { email: string | null; teams: TeamSummary[] }) {
  const t = useTranslations('account');
  const word = useTeamError();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const owned = teams.filter((team) => team.role === 'admin');
  const blocking = owned.filter((team) => team.memberCount > 1);
  const going = owned.filter((team) => team.memberCount <= 1);
  const expected = email ?? 'DELETE';

  return (
    <Section
      title={t('delete')}
      description={t('deleteHint')}
      action={
        <Button variant="outline" className="text-destructive hover:text-destructive" disabled={blocking.length > 0} onClick={() => setOpen(true)}>
          <Trash2 />
          {t('delete')}
        </Button>
      }
    >
      {blocking.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{t('deleteBlocked')}</p>
          <ul className="overflow-hidden rounded-lg border">
            {blocking.map((team) => (
              <li key={team.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0">
                <span className="min-w-0 flex-1 truncate font-medium">{team.name}</span>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/teams/${team.id}/members`}>{t('openMembers')}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteDescription')}</DialogDescription>
          </DialogHeader>
          {going.length > 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">{t('deleteTeams')}</p>
              <ul className="list-disc pl-5">
                {going.map((team) => (
                  <li key={team.id} className="font-medium">
                    {team.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <form
            id="delete-account"
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              try {
                await api('profile', { method: 'DELETE', body: { confirm: typed } });
                toast.success(t('deleted'));
                await refresh();
                navigate('/');
              } catch (failure) {
                toast.error(word(failure));
              } finally {
                setPending(false);
              }
            }}
          >
            <Label htmlFor="delete-confirm">{t('deleteConfirm', { email: expected })}</Label>
            <Input id="delete-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </form>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="delete-account" variant="destructive" disabled={pending || typed.trim().toLowerCase() !== expected.toLowerCase()}>
              {t('deleteSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
