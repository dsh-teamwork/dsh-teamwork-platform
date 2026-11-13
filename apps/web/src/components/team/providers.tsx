'use client';

/**
 * A team's providers, for its admin (ADR 0006): where team models are called,
 * and the key they carry. A key goes in and never comes back out; editing a
 * provider moves its address or replaces its key, never its name, which team
 * models refer to.
 */

import type { ProviderView } from '@dsh-teamwork/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { callApi } from '@/lib/api-client';

import { useMutation } from './use-mutation';

const empty = { name: '', baseUrl: '', apiKey: '' };

export function Providers({ teamId, providers }: { teamId: string; providers: ProviderView[] }) {
  const t = useTranslations('team.providers');
  const { pending, run } = useMutation();
  const [editing, setEditing] = useState<ProviderView | null>(null);
  const [form, setForm] = useState(empty);
  const set = (field: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });

  function reset() {
    setEditing(null);
    setForm(empty);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {providers.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  {p.name} · <span className="break-all text-muted-foreground">{p.baseUrl}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setEditing(p);
                      setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: '' });
                    }}
                  >
                    {t('edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(t('removeConfirm'))) run(() => callApi(`teams/${teamId}/providers/${p.id}`, 'DELETE'), t('removed'));
                    }}
                  >
                    {t('remove')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              if (editing) {
                await callApi(`teams/${teamId}/providers/${editing.id}`, 'PUT', { baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}) });
              } else {
                await callApi(`teams/${teamId}/providers`, 'POST', form);
              }
              reset();
            }, editing ? t('saved') : t('added'));
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('name')}</span>
            <Input value={form.name} onChange={set('name')} placeholder="deepseek" maxLength={100} required disabled={!!editing} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('baseUrl')}</span>
            <Input type="url" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://api.deepseek.com/v1" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t('apiKey')}</span>
            <Input
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={set('apiKey')}
              placeholder={editing ? t('apiKeyKeep') : ''}
              required={!editing}
            />
          </label>
          <span className="flex gap-2">
            <Button type="submit" variant="outline" disabled={pending}>
              {editing ? t('save') : t('add')}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={reset}>
                {t('cancel')}
              </Button>
            )}
          </span>
        </form>
      </CardContent>
    </Card>
  );
}
