import { Plugins } from '@/components/team/plugins';
import { listConfigs } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

export default async function TeamPluginsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team } = await consolePage((await params).teamId);
  return <Plugins team={team} configs={await listConfigs(user.id, team.id)} />;
}
