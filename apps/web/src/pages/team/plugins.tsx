/**
 * A team's plugins page (`/teams/{teamId}/plugins`): npm packages pinned at an
 * exact version, so every member runs the same one. Pinning installs nothing;
 * each member confirms an install in DSH. A preset that depends on a plugin
 * pins it at the version it had then, so changing the version here asks those
 * presets to be saved again.
 */

import { Plus } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { Field } from '@/components/team/field';
import { useMutation, useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, type ConfigOf, type Team, type TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';

type Plugin = ConfigOf<'plugin'>;
type Preset = ConfigOf<'preset'>;
type Reload = () => Promise<unknown>;

export function TeamPluginsPage() {
  const { team } = useTeam();
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  return <Plugins team={team} configs={configs.data} reload={configs.reload} />;
}

function Plugins({ team, configs, reload }: { team: Team; configs: TeamConfig[]; reload: Reload }) {
  const t = useTranslations('team.plugins');
  const admin = team.role === 'admin';
  const plugins = configs.filter((c): c is Plugin => c.kind === 'plugin');
  const presets = configs.filter((c): c is Preset => c.kind === 'preset');
  const usedBy = (id: string) => presets.filter((p) => p.data.pluginDependencies.some((d) => d.pluginConfigId === id));
  const [editing, setEditing] = useState<Plugin | true | null>(null);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        action={
          admin && (
            <Button onClick={() => setEditing(true)}>
              <Plus />
              {t('pin')}
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        {plugins.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{t('name')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('package')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('tools')}</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t('usedBy')}</th>
                  {admin && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {plugins.map((p) => (
                  <PluginRow key={p.id} teamId={team.id} reload={reload} plugin={p} admin={admin} usedBy={usedBy(p.id).map((preset) => preset.name)} onEdit={() => setEditing(p)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {admin && editing && <PluginDialog teamId={team.id} reload={reload} plugin={editing === true ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PluginRow({ teamId, reload, plugin, admin, usedBy, onEdit }: { teamId: string; reload: Reload; plugin: Plugin; admin: boolean; usedBy: string[]; onEdit: () => void }) {
  const t = useTranslations('team.plugins');
  const { pending, run } = useMutation(reload);
  return (
    <tr className="border-b align-top last:border-b-0">
      <td className="px-4 py-3">
        <span className="font-medium">{plugin.name}</span>
        {plugin.data.description && <p className="mt-0.5 text-xs text-muted-foreground">{plugin.data.description}</p>}
      </td>
      <td className="px-4 py-3 font-mono text-xs [overflow-wrap:anywhere]">
        {plugin.data.package}@{plugin.data.version}
      </td>
      <td className="px-4 py-3">
        <span className="flex flex-wrap gap-1">
          {plugin.data.providesTools.map((name) => (
            <span key={name} className="rounded border bg-muted px-1.5 font-mono text-xs">
              {name}
            </span>
          ))}
          {plugin.data.providesTools.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
        </span>
      </td>
      <td className="px-4 py-3">
        {usedBy.length ? (
          <span className="flex flex-wrap gap-1">
            {usedBy.map((name) => (
              <span key={name} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {name}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('unused')}</span>
        )}
      </td>
      {admin && (
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t('edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            // The server refuses too (plugin_in_use): presets pin it.
            disabled={pending || usedBy.length > 0}
            title={usedBy.length ? t('removeUsed', { count: usedBy.length }) : undefined}
            onClick={() => {
              if (confirm(t('removeConfirm', { name: plugin.name }))) void run(() => api(`teams/${teamId}/configs/${plugin.id}`, { method: 'DELETE' }), t('removed'));
            }}
          >
            {t('remove')}
          </Button>
        </td>
      )}
    </tr>
  );
}

function PluginDialog({ teamId, reload, plugin, onClose }: { teamId: string; reload: Reload; plugin?: Plugin; onClose: () => void }) {
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
            const body = { kind: 'plugin', name: form.name.trim(), data, ...(plugin ? { version: plugin.version } : {}) };
            const path = plugin ? `teams/${teamId}/configs/${plugin.id}` : `teams/${teamId}/configs`;
            if (await run(() => api(path, { method: plugin ? 'PATCH' : 'POST', body }), t('saved'))) onClose();
          }}
        >
          <Field id="plugin-name" label={t('name')}>
            <Input id="plugin-name" value={form.name} onChange={set('name')} maxLength={100} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field id="plugin-package" label={t('package')}>
              <Input id="plugin-package" value={form.package} onChange={set('package')} placeholder="@scope/name" required className="font-mono" />
            </Field>
            <Field id="plugin-version" label={t('version')} hint={plugin ? t('versionHint') : undefined}>
              <Input id="plugin-version" value={form.version} onChange={set('version')} placeholder="1.0.0" required className="font-mono" />
            </Field>
          </div>
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
