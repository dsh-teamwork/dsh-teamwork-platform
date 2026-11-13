import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/team/console-shell';
import { consolePage } from '@/lib/team-page';

/** A team's overview. */
export default async function TeamOverviewPage({ params }: { params: Promise<{ teamId: string }> }) {
  await consolePage((await params).teamId);
  const t = await getTranslations('team');
  return <PageHeader title={t('nav.overview')} description={t('overview')} />;
}
