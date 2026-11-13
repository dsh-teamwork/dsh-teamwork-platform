import { Presets } from '@/components/team/presets';
import { listConfigs } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

export default async function TeamPresetsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team } = await consolePage((await params).teamId);
  return <Presets team={team} configs={await listConfigs(user.id, team.id)} />;
}
