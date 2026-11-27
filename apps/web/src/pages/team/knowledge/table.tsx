/**
 * A folder as a table (`/teams/{teamId}/knowledge/table/{spaceId}[/{folderId}]`,
 * docs/tech/knowledge.md, "Format"): the documents directly in a folder, or
 * at a space's root, one row each with the properties their front matter
 * gives (`@dsh-teamwork/shared/knowledge-properties`). It filters by words, status and tag
 * and sorts by any column; nothing it shows is stored apart from the
 * documents, so editing a property is editing its document.
 */

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';

import { useTeamError } from '@/components/team/use-mutation';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Schemas, Team } from '@/lib/api';
import { parseOwner, readProperties, type Properties } from '@dsh-teamwork/shared/knowledge-properties';
import { folderPaths, type KnowledgeTree } from '@dsh-teamwork/shared/knowledge-tree';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

type Column = 'title' | 'owner' | 'status' | 'tags' | 'updated';

interface Row {
  row: Schemas['KnowledgeRow'];
  properties: Properties;
  owner: string;
}

export function TableView({ team, tree, spaceId, folderId }: { team: Team; tree: KnowledgeTree; spaceId: string; folderId: string }) {
  const t = useTranslations('team.knowledge.table');
  const tp = useTranslations('team.knowledge.properties');
  const format = useFormatter();
  const word = useTeamError();
  const page = `/teams/${team.id}/knowledge`;
  const { data, error } = useApi<{ rows: Schemas['KnowledgeRow'][] }>(
    `teams/${encodeURIComponent(team.id)}/knowledge/spaces/${encodeURIComponent(spaceId)}/documents${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`,
  );
  const [words, setWords] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<{ by: Column; down: boolean }>({ by: 'title', down: false });

  const space = tree.spaces.find((s) => s.id === spaceId);
  const where = [space?.name ?? '', ...(space && folderId ? (folderPaths(space).find((f) => f.id === folderId)?.path ?? []) : [])].join(' / ');
  const ownerName = (owner: string) => {
    const { id, name } = parseOwner(owner);
    return team.members.find((m) => m.userId === id)?.email ?? name;
  };
  const rows: Row[] = (data?.rows ?? []).map((row) => {
    const properties = readProperties(row.frontMatter) ?? { owner: '', status: '', tags: [], summary: '' };
    return { row, properties, owner: properties.owner ? ownerName(properties.owner) : '' };
  });
  const statuses = [...new Set(rows.map((r) => r.properties.status).filter(Boolean))].sort();
  const tags = [...new Set(rows.flatMap((r) => r.properties.tags))].sort();
  const q = words.trim().toLocaleLowerCase();
  const value = (r: Row, by: Column) =>
    by === 'title' ? r.row.title : by === 'owner' ? r.owner : by === 'status' ? r.properties.status : by === 'tags' ? r.properties.tags.join(', ') : r.row.updatedAt;
  const shown = rows
    .filter((r) => (!status || r.properties.status === status) && (!tag || r.properties.tags.includes(tag)))
    .filter((r) => !q || [r.row.title, r.owner, r.properties.status, r.properties.summary, ...r.properties.tags].some((v) => v.toLocaleLowerCase().includes(q)))
    .sort((a, b) => {
      const x = value(a, sort.by);
      const y = value(b, sort.by);
      // Empty sorts last either way.
      if (!x !== !y) return x ? -1 : 1;
      return (sort.down ? -1 : 1) * x.localeCompare(y);
    });

  const header = (by: Column, label: string) => (
    <th scope="col" aria-sort={sort.by === by ? (sort.down ? 'descending' : 'ascending') : 'none'} className="px-3 py-2 text-left font-medium">
      <button type="button" onClick={() => setSort({ by, down: sort.by === by ? !sort.down : by === 'updated' })} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {sort.by === by && (sort.down ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{where}</h1>
        <p className="text-sm text-muted-foreground">{t('note')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-full sm:w-56" type="search" value={words} onChange={(e) => setWords(e.target.value)} placeholder={t('filter')} aria-label={t('filter')} />
        {statuses.length > 0 && (
          <Select label={tp('status')} value={status} options={[{ value: '', label: t('anyStatus') }, ...statuses.map((s) => ({ value: s, label: s }))]} change={setStatus} className="w-full sm:w-44" />
        )}
        {tags.length > 0 && <Select label={tp('tags')} value={tag} options={[{ value: '', label: t('anyTag') }, ...tags.map((s) => ({ value: s, label: s }))]} change={setTag} className="w-full sm:w-44" />}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{word(error)}</p> : null}
      {data && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {header('title', t('title'))}
                {header('owner', tp('owner'))}
                {header('status', tp('status'))}
                {header('tags', tp('tags'))}
                {header('updated', t('updated'))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => (
                <tr key={r.row.id} className="align-top">
                  <td className="px-3 py-2">
                    <Link to={`${page}/${r.row.id}`} className="font-medium underline-offset-4 hover:underline">{r.row.title}</Link>
                    {r.properties.summary && <p className="mt-0.5 text-xs text-muted-foreground">{r.properties.summary}</p>}
                  </td>
                  <td className="px-3 py-2">{r.owner}</td>
                  <td className="px-3 py-2">{r.properties.status && <span className="rounded-full border px-2 py-0.5 text-xs">{r.properties.status}</span>}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {r.properties.tags.map((tagName) => (
                        <button key={tagName} type="button" onClick={() => setTag(tagName)} className={cn('rounded-md bg-muted px-1.5 py-0.5 text-xs', tag === tagName && 'ring-1 ring-ring')}>
                          {tagName}
                        </button>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{format.relativeTime(new Date(r.row.updatedAt), new Date())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">{t('noMatch')}</p>}
        </div>
      )}
    </div>
  );
}
