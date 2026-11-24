/**
 * Who may read an artifact (docs/tech/artifacts.md, "Terms"): only its owner, chosen members of its team, or everyone in the
 * team. Its owner chooses any; the team's admin only narrows what it already admits (Restrict), which the server holds
 * too (`artifact_sharing_widened`), so an admin cannot share an artifact with themselves to read it.
 */

import { Check, Lock, Search, Users, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError, type Schemas, type Team } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

type Detail = Schemas['ArtifactDetail'];
type Mode = Detail['sharing'];

export function ShareDialog({ teamId, artifact, open, onOpenChange, onSaved }: {
  teamId: string;
  artifact: Detail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const t = useTranslations('team.artifacts.shareDialog');
  const narrowing = artifact.access === 'admin';
  const { data: team } = useApi<Team>(open ? `teams/${encodeURIComponent(teamId)}` : null);
  const [mode, setMode] = useState<Mode>(artifact.sharing);
  const [picked, setPicked] = useState<string[]>(artifact.members.map((m) => m.id));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // What an admin may choose: nothing that admits someone the artifact does not admit now.
  const before = new Set(artifact.members.map((m) => m.id));
  const allowedMember = (id: string) => id !== artifact.owner.id && (!narrowing || artifact.sharing === 'team' || before.has(id));
  const modes: { m: Mode; Icon: typeof Lock }[] = [
    { m: 'private', Icon: Lock },
    { m: 'members', Icon: Users },
    { m: 'team', Icon: UsersRound },
  ];
  const available = (m: Mode) => !narrowing || m === 'private' || m === artifact.sharing || (m === 'members' && artifact.sharing === 'team');
  const people = (team?.members ?? []).filter((m) => allowedMember(m.userId));
  const label = (id: string) => team?.members.find((m) => m.userId === id)?.email ?? artifact.members.find((m) => m.id === id)?.email ?? id;
  const matches = people.filter((m) => !picked.includes(m.userId) && (!query || (m.email ?? '').toLowerCase().includes(query.toLowerCase())));

  async function save() {
    setBusy(true);
    setFailed(null);
    try {
      await api(`teams/${encodeURIComponent(teamId)}/artifacts/${encodeURIComponent(artifact.id)}/sharing`, {
        method: 'PUT',
        body: mode === 'members' ? { mode, members: picked } : { mode },
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setFailed(error instanceof ApiError && ['artifact_sharing_widened', 'artifact_member_not_in_team'].includes(error.code) ? t(error.code) : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(narrowing ? 'restrictTitle' : 'title', { title: artifact.title })}</DialogTitle>
          <DialogDescription>{t(narrowing ? 'restrictNote' : 'note')}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" className="flex flex-col gap-2">
          {modes.filter(({ m }) => available(m)).map(({ m, Icon }) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors', mode === m ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="flex flex-1 flex-col">
                <span className="text-sm font-medium">{t(`${m}.label`)}</span>
                <span className="text-xs text-muted-foreground">{t(`${m}.note`)}</span>
              </span>
              {mode === m && <Check className="size-4 text-primary" aria-hidden />}
            </button>
          ))}
        </div>
        {mode === 'members' && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('find')} aria-label={t('find')} />
            </div>
            {matches.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
                {matches.map((m) => (
                  <li key={m.userId}>
                    <button type="button" className="w-full px-3 py-2 text-left hover:bg-accent" onClick={() => (setPicked([...picked, m.userId]), setQuery(''))}>
                      {m.email ?? m.userId}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {picked.map((id) => (
                <li key={id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent/50">
                  <span>{label(id)}</span>
                  <button type="button" aria-label={t('remove', { name: label(id) })} onClick={() => setPicked(picked.filter((x) => x !== id))} className="text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button disabled={busy || (mode === 'members' && picked.length === 0)} onClick={() => void save()}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
