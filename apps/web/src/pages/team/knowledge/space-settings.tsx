/**
 * A space's settings, an editor's (docs/tech/knowledge.md, "Rules"): its
 * name, who reads it (the whole team, or chosen members) and who edits it
 * besides its creator and the team's admins, who always do; the folder its
 * templates are in, whose documents a new document may start from; and
 * deleting it with everything in it.
 */

import { Check, Search, Trash2, Users, UsersRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, type Schemas, type Team } from '@/lib/api';
import { folderPaths, type KnowledgeSpace } from '@/lib/knowledge-tree';
import { cn } from '@/lib/utils';

type Access = Schemas['KnowledgeAccess'];

export function SpaceSettingsDialog({ team, space, onClose, onChanged, onDeleted }: {
  team: Team;
  space: KnowledgeSpace;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('team.knowledge.settings');
  const word = useTeamError();
  const base = `teams/${encodeURIComponent(team.id)}/knowledge/spaces/${encodeURIComponent(space.id)}`;
  const [name, setName] = useState(space.name);
  const [templates, setTemplates] = useState(space.templatesFolderId);
  const [access, setAccess] = useState<Access | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Access>(`${base}/access`).then(
      (a) => live && setAccess(a),
      (error: unknown) => live && setLoadFailed(word(error)),
    );
    return () => {
      live = false;
    };
    // word is a fresh function every render; the access is read once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const admins = new Set(team.members.filter((m) => m.role === 'admin').map((m) => m.userId));
  const choosable = team.members.filter((m) => !admins.has(m.userId));

  async function save() {
    if (!access) return;
    setBusy(true);
    setFailed(null);
    try {
      const patch = {
        ...(name.trim() !== space.name ? { name: name.trim() } : {}),
        ...(templates !== space.templatesFolderId ? { templatesFolderId: templates } : {}),
      };
      if (Object.keys(patch).length > 0) await api(base, { method: 'PATCH', body: patch });
      await api(`${base}/access`, { method: 'PUT', body: access.reading === 'team' ? { ...access, readers: [] } : access });
      toast.success(t('saved'));
      onChanged();
      onClose();
    } catch (error) {
      setFailed(word(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('deleteConfirm', { name: space.name, documents: space.documents.length }))) return;
    setBusy(true);
    try {
      await api(base, { method: 'DELETE' });
      toast.success(t('deleted', { name: space.name }));
      onDeleted();
      onClose();
    } catch (error) {
      setFailed(word(error));
    } finally {
      setBusy(false);
    }
  }

  const modes = [
    { mode: 'team' as const, Icon: UsersRound },
    { mode: 'members' as const, Icon: Users },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title', { name: space.name })}</DialogTitle>
          <DialogDescription>{t('note')}</DialogDescription>
        </DialogHeader>
        <Field id="space-name" label={t('name')}>
          <Input id="space-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="space-templates" label={t('templates')} hint={t('templatesNote')}>
          <Select
            id="space-templates"
            label={t('templates')}
            value={templates}
            options={[{ value: '', label: t('noTemplates') }, ...folderPaths(space).map((f) => ({ value: f.id, label: f.path.join(' / ') }))]}
            change={setTemplates}
            className="w-full"
          />
        </Field>
        {loadFailed ? (
          <p role="alert" className="text-sm text-destructive">{loadFailed}</p>
        ) : !access ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('reading')}</legend>
              <div role="radiogroup" aria-label={t('reading')} className="flex flex-col gap-2">
                {modes.map(({ mode, Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={access.reading === mode}
                    onClick={() => setAccess({ ...access, reading: mode })}
                    className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors', access.reading === mode ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm font-medium">{t(`${mode}.label`)}</span>
                      <span className="text-xs text-muted-foreground">{t(`${mode}.note`)}</span>
                    </span>
                    {access.reading === mode && <Check className="size-4 text-primary" aria-hidden />}
                  </button>
                ))}
              </div>
            </fieldset>
            {access.reading === 'members' && (
              <MemberPicker
                label={t('readers')}
                hint={t('readersHint')}
                members={choosable.filter((m) => !access.editors.includes(m.userId))}
                picked={access.readers}
                change={(readers) => setAccess({ ...access, readers })}
                all={team.members}
              />
            )}
            <MemberPicker
              label={t('editors')}
              hint={t('editorsHint')}
              members={choosable}
              picked={access.editors}
              change={(editors) => setAccess({ ...access, editors, readers: access.readers.filter((id) => !editors.includes(id)) })}
              all={team.members}
            />
          </>
        )}
        {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()}>
            <Trash2 className="size-4" aria-hidden />
            {t('delete')}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button disabled={busy || !access || !name.trim()} onClick={() => void save()}>{t('save')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Chooses members by email, as an artifact's sharing does: a search above, the chosen below, each removable. */
function MemberPicker({ label, hint, members, picked, change, all }: {
  label: string;
  hint: string;
  members: Team['members'];
  picked: string[];
  change: (ids: string[]) => void;
  all: Team['members'];
}) {
  const t = useTranslations('team.knowledge.settings');
  const [query, setQuery] = useState('');
  const email = (id: string) => all.find((m) => m.userId === id)?.email ?? id;
  const matches = members.filter((m) => !picked.includes(m.userId) && (!query || (m.email ?? '').toLowerCase().includes(query.toLowerCase())));
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('find')} aria-label={`${label}: ${t('find')}`} />
        </div>
        {query && matches.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t('noMatch')}</p>}
        {(query || picked.length === 0) && matches.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
            {matches.map((m) => (
              <li key={m.userId}>
                <button type="button" className="w-full px-3 py-2 text-left hover:bg-accent" onClick={() => (change([...picked, m.userId]), setQuery(''))}>
                  {m.email ?? m.userId}
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {picked.map((id) => (
              <li key={id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent/50">
                <span className="truncate">{email(id)}</span>
                <button type="button" aria-label={t('remove', { name: email(id) })} onClick={() => change(picked.filter((x) => x !== id))} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
