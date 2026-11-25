/**
 * A document's properties on its page (lib/knowledge-properties.ts): a row
 * under the title while reading, and a form above the text while editing,
 * whose every change rewrites the front matter the save carries. The owner is
 * chosen from the team's members; one written by hand, or a member who has
 * left, stays as written until someone else is chosen.
 */

import { useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Team } from '@/lib/api';
import { ownerMention, parseOwner, type Properties } from '@/lib/knowledge-properties';

/** Who an owner is, as the team now names them. */
function ownerName(team: Team, owner: string): string {
  const { id, name } = parseOwner(owner);
  return team.members.find((m) => m.userId === id)?.email ?? name;
}

/** The row under the title, or nothing for a document with no properties. */
export function PropertiesRow({ team, properties }: { team: Team; properties: Properties }) {
  const t = useTranslations('team.knowledge.properties');
  const { owner, status, tags, summary } = properties;
  if (!owner && !status && tags.length === 0 && !summary) return null;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {summary && <p className="text-muted-foreground">{summary}</p>}
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {owner && (
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">{t('owner')}</dt>
            <dd>{ownerName(team, owner)}</dd>
          </div>
        )}
        {status && (
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">{t('status')}</dt>
            <dd className="rounded-full border px-2 py-0.5">{status}</dd>
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">{t('tags')}</dt>
            <dd className="flex flex-wrap gap-1">
              {tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5">{tag}</span>)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** The form above the text while editing; null properties are front matter it cannot read, left as written. */
export function PropertiesForm({ team, properties, onChange }: { team: Team; properties: Properties | null; onChange: (next: Properties) => void }) {
  const t = useTranslations('team.knowledge.properties');
  if (!properties) return <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">{t('unreadable')}</p>;
  const { id } = parseOwner(properties.owner);
  const known = team.members.some((m) => m.userId === id);
  const owners = [
    { value: '', label: t('noOwner') },
    ...(properties.owner && !known ? [{ value: properties.owner, label: parseOwner(properties.owner).name || properties.owner }] : []),
    ...team.members.map((m) => ({ value: ownerMention(m.userId, m.name || m.email || m.userId), label: [m.name, m.email || m.userId].filter(Boolean).join(' · ') })),
  ];
  const ownerValue = known ? (owners.find((o) => parseOwner(o.value).id === id)?.value ?? properties.owner) : properties.owner;
  return (
    <fieldset className="grid gap-3 rounded-lg border px-4 py-3 sm:grid-cols-2">
      <legend className="px-1 text-xs text-muted-foreground">{t('title')}</legend>
      <Field id="knowledge-owner" label={t('owner')}>
        <Select id="knowledge-owner" label={t('owner')} value={ownerValue} options={owners} change={(owner) => onChange({ ...properties, owner })} className="w-full" />
      </Field>
      <Field id="knowledge-status" label={t('status')}>
        <Input id="knowledge-status" value={properties.status} maxLength={40} placeholder={t('statusPlaceholder')} onChange={(e) => onChange({ ...properties, status: e.target.value })} />
      </Field>
      <Field id="knowledge-tags" label={t('tags')} hint={t('tagsHint')}>
        <Input
          id="knowledge-tags"
          defaultValue={properties.tags.join(', ')}
          onChange={(e) => onChange({ ...properties, tags: e.target.value.split(/[,\uff0c]/).map((tag) => tag.trim()).filter(Boolean) })}
        />
      </Field>
      <Field id="knowledge-summary" label={t('summary')}>
        <Input id="knowledge-summary" value={properties.summary} maxLength={200} placeholder={t('summaryPlaceholder')} onChange={(e) => onChange({ ...properties, summary: e.target.value })} />
      </Field>
    </fieldset>
  );
}
