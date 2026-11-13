import { mustChangePassword } from '@dsh-teamwork/shared/server/passwords';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TeamsHome } from '@/components/team/teams-home';
import { currentUser } from '@/lib/auth';
import { strategy } from '@/lib/auth/strategy';
import { teamsOf } from '@/lib/team';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('team.list'))('title'), robots: { index: false } };
}

/** Every team the person is in (ADR 0013); an invitation link lands here with `?invite=`. */
export default async function TeamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const invite = typeof params.invite === 'string' ? params.invite : '';
  const here = invite ? `/teams?invite=${encodeURIComponent(invite)}` : '/teams';
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  if (strategy.passwords && (await mustChangePassword(user.id))) redirect(`/password?next=${encodeURIComponent(here)}`);

  return <TeamsHome email={user.email} teams={await teamsOf(user.id)} invite={invite} passwords={strategy.passwords} />;
}
