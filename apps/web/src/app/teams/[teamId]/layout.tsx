import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ConsoleShell } from '@/components/team/console-shell';
import { strategy } from '@/lib/auth/strategy';
import { teamsOf } from '@/lib/team';
import { consolePage } from '@/lib/team-page';

export async function generateMetadata({ params }: { params: Promise<{ teamId: string }> }): Promise<Metadata> {
  const { team } = await consolePage((await params).teamId);
  return { title: team.name, robots: { index: false } };
}

/** Every page of one team's console, inside its sidebar (ADR 0013: the team is in the URL). */
export default async function TeamLayout({ params, children }: { params: Promise<{ teamId: string }>; children: ReactNode }) {
  const { user, team } = await consolePage((await params).teamId);
  // Only the sidebar needs every team, and a layout is not re-rendered when the page beside it changes.
  const teams = await teamsOf(user.id);
  return (
    <ConsoleShell team={team} teams={teams} email={user.email} passwords={strategy.passwords}>
      {children}
    </ConsoleShell>
  );
}
