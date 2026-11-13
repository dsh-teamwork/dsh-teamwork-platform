import { Models } from '@/components/team/models';
import { listConfigs, listProviders } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

export default async function TeamModelsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team, admin } = await consolePage((await params).teamId);
  const [configs, providers] = await Promise.all([
    listConfigs(user.id, team.id),
    admin ? listProviders(user.id, team.id) : Promise.resolve([]),
  ]);
  return <Models team={team} configs={configs} providers={providers} />;
}
