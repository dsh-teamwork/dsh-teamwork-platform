import { Overview } from '@/components/team/overview';
import { listConfigs, listProviders } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

/** A team's overview: what it has, what is left to set up, and what changed. */
export default async function TeamOverviewPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team, admin } = await consolePage((await params).teamId);
  const [configs, providers] = await Promise.all([
    listConfigs(user.id, team.id),
    admin ? listProviders(user.id, team.id) : Promise.resolve([]),
  ]);
  return <Overview team={team} configs={configs} providerCount={providers.length} />;
}
