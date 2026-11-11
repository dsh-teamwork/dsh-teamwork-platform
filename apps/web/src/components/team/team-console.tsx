'use client';

import type { InviteView, TeamConfigView, TeamView } from '@dsh-teamwork/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { callApi } from '@/lib/api-client';
import type { AddedMember, CreatedInvite, ResetPassword } from '@dsh-teamwork/shared';

import { ConfigForm } from './config-form';
import { ConsoleHeader } from './console-header';
import { useMutation } from './use-mutation';

interface Props {
  me: { id: string; email: string };
  team: TeamView;
  configs: TeamConfigView[];
  invites: InviteView[];
  /** The instance holds passwords: an admin creates accounts instead of sending invitations. */
  passwords: boolean;
}

export function TeamConsole({ me, team, configs, invites, passwords }: Props) {
  const t = useTranslations('team');
  const { pending, run } = useMutation();
  const admin = team.role === 'admin';
  const [editing, setEditing] = useState<TeamConfigView | null>(null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-6 py-10">
      <ConsoleHeader email={me.email} passwords={passwords} />

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{team.name}</CardTitle>
            <CardDescription>
              {t(`role.${team.role}`)} · {t('overview')}
            </CardDescription>
          </div>
          {!admin && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (confirm(t('leave.confirm'))) run(() => callApi('team/membership', 'DELETE'), t('leave.done'));
              }}
            >
              {t('leave.submit')}
            </Button>
          )}
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('configs.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {configs.length === 0 && <p className="text-sm text-muted-foreground">{t('configs.empty')}</p>}
            {configs.map((config) => (
              <ConfigItem
                key={config.id}
                config={config}
                configs={configs}
                admin={admin}
                pending={pending}
                onEdit={() => setEditing(config)}
                onDelete={() => {
                  if (confirm(t('configs.deleteConfirm'))) run(() => callApi(`team/configs/${config.id}`, 'DELETE'), t('configs.deleted'));
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
              <ConfigForm key={editing?.id ?? 'new'} editing={editing} configs={configs} onDone={() => setEditing(null)} />
            </CardContent>
          </Card>
        )}
      </div>

      <Members me={me} team={team} invites={invites} passwords={passwords} />
    </main>
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

function Members({ me, team, invites, passwords }: { me: Props['me']; team: TeamView; invites: InviteView[]; passwords: boolean }) {
  const t = useTranslations('team');
  const format = useFormatter();
  const { pending, run } = useMutation();
  const [link, setLink] = useState('');
  const [email, setEmail] = useState('');
  // A first password is shown once, beside whose it is, and gone on reload.
  const [handover, setHandover] = useState<{ email: string; password: string | null } | null>(null);
  const admin = team.role === 'admin';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('members.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="flex flex-col gap-2">
          {team.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2">
              <span>
                {m.email} · <span className="text-muted-foreground">{t(`role.${m.role}`)}</span>
              </span>
              {admin && m.userId !== me.id && (
                <span className="flex gap-1">
                  {passwords && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(t('members.resetConfirm'))) return;
                        run(async () => {
                          const reset = await callApi<ResetPassword>(`team/members/${m.userId}/password`, 'POST');
                          setHandover({ email: m.email, password: reset.password });
                        }, t('members.resetDone'));
                      }}
                    >
                      {t('members.reset')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(t('members.removeConfirm'))) run(() => callApi(`team/members/${m.userId}`, 'DELETE'), t('members.removed'));
                    }}
                  >
                    {t('members.remove')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {admin && passwords && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  const added = await callApi<AddedMember>('team/members', 'POST', { email });
                  setHandover({ email: added.email, password: added.password });
                  setEmail('');
                }, t('members.added'));
              }}
            >
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-muted-foreground">{t('members.addEmail')}</span>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <Button type="submit" variant="outline" disabled={pending}>
                {t('members.addSubmit')}
              </Button>
            </form>
            {handover && (
              <div className="flex flex-col gap-1">
                {handover.password ? (
                  <>
                    <span className="text-muted-foreground">{t('members.firstPassword', { email: handover.email })}</span>
                    <Input readOnly value={handover.password} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
                  </>
                ) : (
                  <span className="text-muted-foreground">{t('members.existing', { email: handover.email })}</span>
                )}
              </div>
            )}
          </div>
        )}
        {admin && !passwords && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <Button
              className="self-start"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const created = await callApi<CreatedInvite>('team/invites', 'POST');
                  setLink(`${location.origin}/team?invite=${created.token}`);
                }, t('invites.created'))
              }
            >
              {t('invites.create')}
            </Button>
            {link && (
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">{t('invites.link')}</span>
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              </label>
            )}
            {invites
              .filter((i) => !i.usedAt)
              .map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t('invites.expires', { at: format.dateTime(new Date(i.expiresAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        await callApi(`team/invites/${i.id}`, 'DELETE');
                        setLink('');
                      }, t('invites.revoked'))
                    }
                  >
                    {t('invites.revoke')}
                  </Button>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
