/**
 * What the team provides (`/teams/{teamId}/resources`), under Work for
 * everyone (ADR 0043): its models, presets and pinned plugins as one read-only
 * catalogue, each with how it shows up in DSH, and a model's rate. Changing
 * them is Team assets's, the admin's alone; a member proposes a preset, or
 * a change to one, here in the presets editor, which sends it to review.
 */

import { FileJson } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';

import { Failure } from '@/components/page';
import { PageHeader } from '@/components/team/console-shell';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import type { TeamConfig } from '@/lib/api';
import { useApi } from '@/lib/use-api';

import { useTeam } from './layout';
import { ModelRateButton } from './model-rate';
import { blankDraft, presetDraft, PresetEditor, type Draft } from './presets';

export function TeamResourcesPage() {
  const { team } = useTeam();
  const t = useTranslations('team.resources');
  const tn = useTranslations('team.nav');
  const word = useTeamError();
  const configs = useApi<TeamConfig[]>(`teams/${team.id}/configs`);
  // An admin changes presets in Team assets; a member proposes here.
  const member = team.role === 'member';
  const [proposing, setProposing] = useState<{ draft: Draft; preset?: Extract<TeamConfig, { kind: 'preset' }> } | null>(null);
  if (!configs.data) return configs.error ? <Failure message={word(configs.error)} /> : null;
  const all = configs.data;
  const of = <K extends TeamConfig['kind']>(kind: K) => all.filter((c): c is Extract<TeamConfig, { kind: K }> => c.kind === kind);

  return (
    <>
      <PageHeader
        title={tn('resources')}
        description={t('description')}
        action={
          member && (
            <Button variant="outline" onClick={() => setProposing({ draft: blankDraft(of('model')) })}>
              <FileJson />
              {t('propose')}
            </Button>
          )
        }
      />
      <Group title={t('models')} hint={t('modelsHint')} empty={t('noModels')}>
        {of('model').map((m) => (
          <Row key={m.id} name={m.name} detail={m.data.model}>
            <ModelRateButton teamId={team.id} configId={m.id} name={m.name} admin={false} provider={m.data.provider} model={m.data.model} />
          </Row>
        ))}
      </Group>
      <Group title={t('presets')} hint={t('presetsHint')} empty={t('noPresets')}>
        {of('preset').map((p) => (
          <Row key={p.id} name={p.name} detail={p.data.description}>
            {member && (
              <Button size="sm" variant="ghost" onClick={() => setProposing({ draft: presetDraft(p), preset: p })}>
                {t('proposeChange')}
              </Button>
            )}
          </Row>
        ))}
      </Group>
      <Group title={t('plugins')} hint={t('pluginsHint')} empty={t('noPlugins')}>
        {of('plugin').map((p) => (
          <Row key={p.id} name={p.name} detail={`${p.data.package}@${p.data.version}`} mono />
        ))}
      </Group>
      {proposing && (
        <PresetEditor
          teamId={team.id}
          submitForReview
          reload={configs.reload}
          initial={proposing.draft}
          preset={proposing.preset}
          models={of('model')}
          plugins={of('plugin')}
          onClose={() => setProposing(null)}
        />
      )}
    </>
  );
}

function Group({ title, hint, empty, children }: { title: string; hint: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{hint}</p>
      </div>
      {children.length === 0 ? (
        <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border">{children}</ul>
      )}
    </section>
  );
}

/** Lists are rows, not cards (docs/design.md, "Component rules"). */
function Row({ name, detail, mono = false, children }: { name: string; detail?: string; mono?: boolean; children?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t px-4 py-2.5 text-sm first:border-t-0">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{name}</span>
        {detail && <span className={mono ? 'font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]' : 'text-xs text-muted-foreground'}>{detail}</span>}
      </span>
      {children}
    </li>
  );
}
