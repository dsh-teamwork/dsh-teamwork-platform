import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { NoTeam } from '@/components/team/no-team';
import { TeamConsole } from '@/components/team/team-console';
import { currentUser } from '@/lib/auth';
import { strategy } from '@/lib/auth/strategy';
import { listConfigs, listInvites, teamOf } from '@/lib/team';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('team'))('title'), robots: { index: false } };
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const invite = typeof params.invite === 'string' ? params.invite : '';
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(invite ? `/team?invite=${invite}` : '/team')}`);
  if (strategy.passwords && (await mustChangePassword(user.id))) redirect('/password?next=/team');

  const team = await teamOf(user.id);
  if (!team) return <NoTeam email={user.email} invite={invite} passwords={strategy.passwords} />;

  const [{ configs }, invites] = await Promise.all([
    listConfigs(user.id),
    team.role === 'admin' ? listInvites(user.id) : Promise.resolve([]),
  ]);
  return (
    <TeamConsole me={{ id: user.id, email: user.email }} team={team} configs={configs} invites={invites} passwords={strategy.passwords} />
  );
}
