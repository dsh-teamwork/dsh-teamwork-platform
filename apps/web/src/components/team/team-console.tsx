'use client';

import type { TeamConfigView, TeamView } from '@dsh-teamwork/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { callApi } from '@/lib/api-client';

import { ConfigForm } from './config-form';
import { useMutation } from './use-mutation';

interface Props {
  team: TeamView;
  configs: TeamConfigView[];
}

/** The team's presets and plugin pins, until the presets and plugins pages replace them. */
export function TeamConsole({ team, configs }: Props) {
  const t = useTranslations('team');
  const { pending, run } = useMutation();
  const admin = team.role === 'admin';
  const teamId = team.id;
  const [editing, setEditing] = useState<TeamConfigView | null>(null);
  // Team models have their own page now.
  const shown = configs.filter((c) => c.kind !== 'model');

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('configs.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {shown.length === 0 && <p className="text-sm text-muted-foreground">{t('configs.empty')}</p>}
            {shown.map((config) => (
              <ConfigItem
                key={config.id}
                config={config}
                configs={configs}
                admin={admin}
                pending={pending}
                onEdit={() => setEditing(config)}
                onDelete={() => {
                  if (confirm(t('configs.deleteConfirm'))) run(() => callApi(`teams/${teamId}/configs/${config.id}`, 'DELETE'), t('configs.deleted'));
                }}
              />
            ))}
          </CardContent>
        </Card>

        {admin && (
          <Card>
            <CardHeader>
              <CardTitle>{editing ? t('form.editTitle') : t('form.newTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ConfigForm key={editing?.id ?? 'new'} teamId={teamId} editing={editing} configs={configs} onDone={() => setEditing(null)} />
            </CardContent>
          </Card>
        )}
      </div>

    </>
  );
}

function ConfigItem({
  config,
  configs,
  admin,
  pending,
  onEdit,
  onDelete,
}: {
  config: TeamConfigView;
  configs: TeamConfigView[];
  admin: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('team');
  const nameOf = (id: string) => configs.find((c) => c.id === id)?.name;

  let summary: string;
  if (config.kind === 'plugin') summary = `${config.data.package}@${config.data.version}`;
  else if (config.kind === 'preset' && config.data.modelConfigId) {
    summary = t('configs.usesModel', { name: nameOf(config.data.modelConfigId) ?? t('configs.missing') });
  } else summary = `${config.data.provider} / ${config.data.model}`;

  return (
    <article className="rounded-lg border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <strong>{config.name}</strong>
        <span className="text-xs text-muted-foreground">
          {t(`kind.${config.kind}`)} · v{config.version}
        </span>
      </div>
      <p className="text-muted-foreground">{summary}</p>
      {config.kind === 'preset' && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">{t('configs.details')}</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{t('form.description')}</dt>
            <dd>{config.data.description || '—'}</dd>
            <dt className="text-muted-foreground">{t('form.instructions')}</dt>
            <dd>{config.data.instructions || '—'}</dd>
            <dt className="text-muted-foreground">{t('form.outputDescription')}</dt>
            <dd>{config.data.outputDescription || '—'}</dd>
            <dt className="text-muted-foreground">{t('form.requiredTools')}</dt>
            <dd>{config.data.requiredTools.join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">{t('form.optionalTools')}</dt>
            <dd>{config.data.optionalTools.join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">{t('form.plugins')}</dt>
            <dd>
              {config.data.pluginDependencies
                .map((d) => `${nameOf(d.pluginConfigId) ?? t('configs.missing')}@${d.version}`)
                .join(', ') || '—'}
            </dd>
          </dl>
          {config.data.systemPrompt && <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{config.data.systemPrompt}</pre>}
          <p className="mt-2 text-xs text-muted-foreground">{t('configs.presetNote')}</p>
        </details>
      )}
      {admin && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={onEdit}>
            {t('configs.edit')}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onDelete}>
            {t('configs.delete')}
          </Button>
        </div>
      )}
    </article>
  );
}
