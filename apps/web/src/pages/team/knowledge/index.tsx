/**
 * Knowledge (`/teams/{teamId}/knowledge`, `…/knowledge/spaces/{spaceId}`,
 * `…/knowledge/{documentId}`, `…/knowledge/proposals[/{proposalId}]`,
 * `…/knowledge/mentions` and `…/knowledge/table/{spaceId}[/{folderId}]`,
 * docs/tech/knowledge.md): the team's documents, which people and agents keep
 * together, in Workspace for every member. The sidebar lists the spaces under
 * Knowledge (lib/knowledge-nav.ts), and this page tells it which is open: the
 * one chosen there, or the one holding the open document or table. The first
 * column is that space's tree, or every space's while none is open or while
 * finding; the second shows the overview of spaces, a space's own page, the
 * open document, the proposals, the reader's mentions or a folder as a
 * table. This page and its editor load only when opened, so Milkdown stays
 * out of the console's main bundle.
 */

import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import { api, type Schemas } from '@/lib/api';
import { publishKnowledgeNav } from '@/lib/knowledge-nav';
import { findDocument, type KnowledgeTree } from '@/lib/knowledge-tree';
import { useApi } from '@/lib/use-api';

import { useTeam } from '../layout';
import { DocumentView } from './document';
import { MentionsView } from './mentions';
import { ProposalsView } from './proposals';
import { NameDialog } from './shared';
import { SpaceHome, SpacesOverview } from './spaces';
import { TableView } from './table';
import { KnowledgeTreePanel } from './tree';

export function KnowledgePage({ view }: { view?: 'proposals' | 'mentions' | 'table' | 'space' }) {
  const { team, me } = useTeam();
  const { documentId = '', proposalId = '', spaceId = '', folderId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const t = useTranslations('team.knowledge');
  const base = `teams/${encodeURIComponent(team.id)}/knowledge`;
  const page = `/teams/${team.id}/knowledge`;
  const tree = useApi<KnowledgeTree>(base);
  const waiting = useApi<{ proposals: Schemas['KnowledgeProposal'][] }>(`${base}/proposals?state=pending`);
  const pending = waiting.data?.proposals.filter((p) => p.canDecide).length ?? 0;
  const changed = () => Promise.all([tree.reload(), waiting.reload()]);

  // The space open: the one chosen, or the one holding the open document.
  const openDocument = !view && documentId && tree.data ? findDocument(tree.data, documentId) : null;
  const currentSpace = view === 'space' || view === 'table' ? spaceId : (openDocument?.space.id ?? '');
  const space = tree.data?.spaces.find((s) => s.id === currentSpace);

  // The sidebar lists what this page read, with the open space selected.
  useEffect(() => {
    if (!tree.data) return;
    publishKnowledgeNav({
      teamId: team.id,
      spaces: tree.data.spaces.map((s) => ({ id: s.id, name: s.name, reading: s.reading })),
      canCreateSpace: tree.data.canCreateSpace,
      current: currentSpace,
    });
  }, [tree.data, team.id, currentSpace]);

  const creating = params.has('newSpace') && !!tree.data?.canCreateSpace;
  const stopCreating = () => {
    const next = new URLSearchParams(params);
    next.delete('newSpace');
    setParams(next, { replace: true });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <KnowledgeTreePanel
        team={team}
        tree={tree.data}
        error={tree.error}
        reload={changed}
        spaceId={currentSpace}
        openId={view ? '' : documentId}
        open={view === 'proposals' || view === 'mentions' ? view : ''}
        pending={pending}
      />
      <section className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-6 pb-8 md:px-8 md:pt-8">
        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-4">
          {view === 'proposals' ? (
            <ProposalsView key={proposalId} team={team} me={me} proposalId={proposalId} onChanged={changed} />
          ) : view === 'mentions' && tree.data ? (
            <MentionsView team={team} tree={tree.data} />
          ) : view === 'table' && tree.data ? (
            <TableView key={`${spaceId}/${folderId}`} team={team} tree={tree.data} spaceId={spaceId} folderId={folderId} />
          ) : view === 'space' && tree.data ? (
            space ? <SpaceHome team={team} space={space} /> : <p role="alert" className="text-sm text-muted-foreground">{t('document.unavailable')}</p>
          ) : documentId && tree.data ? (
            <DocumentView key={documentId} team={team} me={me} tree={tree.data} documentId={documentId} onTreeChanged={changed} />
          ) : tree.data ? (
            <SpacesOverview team={team} tree={tree.data} onNewSpace={() => setParams({ newSpace: '' }, { replace: true })} />
          ) : null}
        </div>
      </section>
      {creating && (
        <NameDialog
          title={t('newSpaceTitle')}
          description={t('newSpaceNote')}
          label={t('spaceName')}
          max={80}
          action={t('create')}
          onClose={stopCreating}
          submit={async (name) => {
            const made = await api<Schemas['KnowledgeSpace']>(`${base}/spaces`, { body: { name } });
            toast.success(t('spaceCreated', { name }));
            await changed();
            void navigate(`${page}/spaces/${made.id}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}
