import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/team/console-shell';
import { TeamConsole } from '@/components/team/team-console';
import { listConfigs } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

/** A team's overview. Until the presets and plugins pages exist, their configuration lives here. */
export default async function TeamOverviewPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team } = await consolePage((await params).teamId);
  const t = await getTranslations('team');
  const configs = await listConfigs(user.id, team.id);
  return (
    <>
      <PageHeader title={t('nav.overview')} description={t('overview')} />
      <TeamConsole team={team} configs={configs} />
    </>
  );
}
