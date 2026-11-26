/**
 * Adding an npm package as one of the team's plugins, pinned at an exact version so every member runs the same one
 * (the admin's "Add from npm" in Presets and plugins). Pinning installs nothing; each member confirms an install in
 * DSH. A preset that depends on a plugin pins it at the version it had then, so changing the version here asks those
 * presets to be saved again.
 */

import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useMutation } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, type ConfigOf } from '@/lib/api';

type Plugin = ConfigOf<'plugin'>;
type Reload = () => Promise<unknown>;

export function NpmPluginDialog({ teamId, reload, plugin, onClose }: { teamId: string; reload: Reload; plugin?: Plugin; onClose: () => void }) {
  const t = useTranslations('team.plugins');
  const { pending, run } = useMutation(reload);
  const [form, setForm] = useState({
    name: plugin?.name ?? '',
    package: plugin?.data.package ?? '',
    version: plugin?.data.version ?? '',
    description: plugin?.data.description ?? '',
    tools: plugin?.data.providesTools.join('\n') ?? '',
  });
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plugin ? t('editTitle') : t('pin')}</DialogTitle>
          <DialogDescription>{t('dialogHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = {
              package: form.package.trim(),
              version: form.version.trim(),
              description: form.description,
              providesTools: form.tools.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
            };
            // A new pin is named after its package unless the admin names it.
            const body = { kind: 'plugin', name: form.name.trim() || data.package.slice(0, 100), data, ...(plugin ? { version: plugin.version } : {}) };
            const path = plugin ? `teams/${teamId}/configs/${plugin.id}` : `teams/${teamId}/configs`;
            if (await run(() => api(path, { method: plugin ? 'PATCH' : 'POST', body }), t('saved'))) onClose();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field id="plugin-package" label={t('package')}>
              <Input id="plugin-package" value={form.package} onChange={set('package')} placeholder="@scope/name" required autoFocus={!plugin} className="font-mono" />
            </Field>
            <Field id="plugin-version" label={t('version')} hint={plugin ? t('versionHint') : undefined}>
              <Input id="plugin-version" value={form.version} onChange={set('version')} placeholder="1.0.0" required className="font-mono" />
            </Field>
          </div>
          <Field id="plugin-name" label={t('name')} hint={plugin ? undefined : t('nameHint')}>
            <Input id="plugin-name" value={form.name} onChange={set('name')} maxLength={100} required={!!plugin} placeholder={plugin ? undefined : form.package.trim()} />
          </Field>
          <Field id="plugin-description" label={t('about')}>
            <Textarea id="plugin-description" value={form.description} onChange={set('description')} maxLength={1000} />
          </Field>
          <Field id="plugin-tools" label={t('tools')} hint={t('toolsHint')}>
            <Textarea id="plugin-tools" value={form.tools} onChange={set('tools')} className="font-mono" />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
