import { t } from '../lib/copy';
import { UserPlus, Users } from 'lucide-react';

import {
  ErrorBanner,
  PageHeader,
  SectionHeading,
  StatCard,
} from '../components/console';
import { useTitle } from '../lib/session';
import type { AdminStats } from '../lib/types';
import { useApi } from '../lib/use-api';

export function DashboardPage() {
  useTitle(t('dashboard'));
  const { data, error } = useApi<AdminStats>('/api/admin/stats');
  return (
    <div>
      <PageHeader title={t('dashboard')} description={t('howThingsStand')} />
      <ErrorBanner error={error} />
      <SectionHeading>{t('customers')}</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('teams')}
          value={data?.teams ?? '—'}
          icon={Users}
          href="/teams"
        />
        <StatCard
          label={t('users')}
          value={data?.users ?? '—'}
          icon={Users}
          href="/users"
        />
        <StatCard
          label={t('newIn7Days')}
          value={data?.newInWeek ?? '—'}
          icon={UserPlus}
        />
      </div>
    </div>
  );
}
