/**
 * Knowledge (`/teams/{teamId}/knowledge[/{documentId}]` and
 * `…/knowledge/proposals[/{proposalId}]`, docs/tech/knowledge.md): the team's
 * documents, which people and agents keep together, in Workspace for every
 * member. The first column is the tree of the spaces the reader reads; the
 * second shows the open document, or the proposals. This page and its editor
 * load only when opened, so Milkdown stays out of the console's main bundle.
 */

import { BookText } from 'lucide-react';
import { useParams } from 'react-router';
import { useTranslations } from 'use-intl';

import type { Schemas } from '@/lib/api';
import type { KnowledgeTree } from '@/lib/knowledge-tree';
import { useApi } from '@/lib/use-api';

import { useTeam } from '../layout';
import { DocumentView } from './document';
import { ProposalsView } from './proposals';
import { KnowledgeTreePanel } from './tree';

export function KnowledgePage({ proposals = false }: { proposals?: boolean }) {
  const { team, me } = useTeam();
  const { documentId = '', proposalId = '' } = useParams();
  const t = useTranslations('team.knowledge');
  const base = `teams/${encodeURIComponent(team.id)}/knowledge`;
  const tree = useApi<KnowledgeTree>(base);
  const waiting = useApi<{ proposals: Schemas['KnowledgeProposal'][] }>(`${base}/proposals?state=pending`);
  const pending = waiting.data?.proposals.filter((p) => p.canDecide).length ?? 0;
  const changed = () => Promise.all([tree.reload(), waiting.reload()]);

  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <KnowledgeTreePanel team={team} tree={tree.data} error={tree.error} reload={changed} openId={proposals ? '' : documentId} proposalsOpen={proposals} pending={pending} />
      <section className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-6 pb-8 md:px-8 md:pt-8">
        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4">
          {proposals ? (
            <ProposalsView key={proposalId} team={team} me={me} proposalId={proposalId} onChanged={changed} />
          ) : documentId && tree.data ? (
            <DocumentView key={documentId} team={team} tree={tree.data} documentId={documentId} onTreeChanged={changed} />
          ) : tree.data ? (
            <div className="flex max-w-prose flex-col gap-3 text-sm text-muted-foreground">
              <BookText className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-base font-medium text-foreground">{t('emptyTitle')}</p>
              <p>{t('emptyHow')}</p>
              <p>{t('emptyAgents')}</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
