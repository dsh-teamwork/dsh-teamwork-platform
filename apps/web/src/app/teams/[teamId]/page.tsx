import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TeamConsole } from '@/components/team/team-console';
import { currentUser } from '@/lib/auth';
import { strategy } from '@/lib/auth/strategy';
import { listConfigs, listInvites, listProviders, TeamError, teamOf } from '@/lib/team';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('team'))('title'), robots: { index: false } };
}

/** One team's console. A team the person is not in is a 404, the same as one that does not exist. */
export default async function TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const here = `/teams/${teamId}`;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  if (strategy.passwords && (await mustChangePassword(user.id))) redirect(`/password?next=${encodeURIComponent(here)}`);

  let team;
  try {
    team = await teamOf(user.id, teamId);
  } catch (error) {
    if (error instanceof TeamError && error.code === 'team_not_found') notFound();
    throw error;
  }
  const admin = team.role === 'admin';
  const [configs, invites, providers] = await Promise.all([
    listConfigs(user.id, teamId),
    admin ? listInvites(user.id, teamId) : Promise.resolve([]),
    admin ? listProviders(user.id, teamId) : Promise.resolve([]),
  ]);
  return (
    <TeamConsole me={{ id: user.id, email: user.email }} team={team} configs={configs} invites={invites} providers={providers} passwords={strategy.passwords} />
  );
}
