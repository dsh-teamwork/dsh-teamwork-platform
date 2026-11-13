import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/team/console-shell';
import { TeamConsole } from '@/components/team/team-console';
import { listConfigs, listProviders } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

/** A team's overview. Until the models, presets and plugins pages exist, its configuration lives here. */
export default async function TeamOverviewPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team, admin } = await consolePage((await params).teamId);
  const t = await getTranslations('team');
  const [configs, providers] = await Promise.all([
    listConfigs(user.id, team.id),
    admin ? listProviders(user.id, team.id) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t('nav.overview')} description={t('overview')} />
      <TeamConsole team={team} configs={configs} providers={providers} />
    </>
  );
}
