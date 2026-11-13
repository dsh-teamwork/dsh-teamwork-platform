import { Members } from '@/components/team/members';
import { strategy } from '@/lib/auth/strategy';
import { listInvites } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

export default async function TeamMembersPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { user, team, admin } = await consolePage((await params).teamId);
  // Invitations exist only where the instance sends email; with passwords, an admin creates accounts instead.
  const invites = admin && !strategy.passwords ? await listInvites(user.id, team.id) : [];
  return <Members me={user.id} team={team} invites={invites} passwords={strategy.passwords} />;
}
