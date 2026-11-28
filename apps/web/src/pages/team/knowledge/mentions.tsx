/**
 * Mentions (`/teams/{teamId}/knowledge/mentions`, docs/tech/knowledge.md,
 * "Format"): the documents the reader reads whose text mentions them,
 * `@[Name](their-id)`, their being named a document's owner included; newest
 * change first, each with the line that names them.
 */

import { Link } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { useTeamError } from '@/components/team/use-mutation';
import type { Schemas, Team } from '@/lib/api';
import { headingSlug, readableLine } from '@dsh-teamwork/shared/knowledge-format';
import type { KnowledgeTree } from '@dsh-teamwork/shared/knowledge-tree';
import { useApi } from '@/lib/use-api';

export function MentionsView({ team, tree }: { team: Team; tree: KnowledgeTree }) {
  const t = useTranslations('team.knowledge.mentions');
  const format = useFormatter();
  const word = useTeamError();
  const { data, error } = useApi<{ documents: Schemas['KnowledgeFound'][] }>(`teams/${encodeURIComponent(team.id)}/knowledge/mentions`);
  const page = `/teams/${team.id}/knowledge`;
  const spaces = new Map(tree.spaces.map((s) => [s.id, s.name]));
  const nameOf = (id: string) => team.members.find((m) => m.userId === id)?.email ?? null;
  // A mention in the owner property reads as the reader being its owner.
  const line = (snippet: string) => (/^owner\s*:/.test(snippet) ? t('owner') : readableLine(snippet, nameOf));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('note')}</p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{word(error)}</p> : null}
      {data && data.documents.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}
      {data && data.documents.length > 0 && (
      <ul className="flex flex-col divide-y rounded-lg border">
        {data.documents.map((d) => (
          <li key={d.id}>
            <Link to={`${page}/${d.id}${d.heading ? `#${encodeURIComponent(headingSlug(d.heading))}` : ''}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-accent/50">
              <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{d.title}</span>
                <span className="text-xs text-muted-foreground">{spaces.get(d.spaceId)} · {format.relativeTime(new Date(d.updatedAt), new Date())}</span>
              </span>
              <span className="line-clamp-2 text-sm text-muted-foreground">{line(d.snippet)}</span>
            </Link>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
