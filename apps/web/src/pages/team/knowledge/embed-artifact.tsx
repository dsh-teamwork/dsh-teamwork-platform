/**
 * Artifacts in a knowledge document (docs/tech/knowledge.md, "Format"):
 * `![[artifact:{id}]]` shows an artifact's card. Each card asks for its
 * artifact as the reader, so one the reader may not open says so rather than
 * showing its title; the document itself grants nothing. The block menu's
 * Artifact opens a choice of the reader's own artifacts and those shared with
 * them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

import type { ArtifactResolver } from '@/components/knowledge-editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type Schemas } from '@/lib/api';
import { ARTIFACT_EMBED, parseWikiTarget } from '@/lib/knowledge-format';
import { cn } from '@/lib/utils';

type Card = { title: string; kind: string } | 'missing';

/**
 * The cards of the artifacts `targets` name, asked for once each; `onLoaded`
 * runs after each answer, for the editor to draw the cards again.
 */
export function useArtifactCards(teamId: string, targets: string[], onLoaded: () => void): ArtifactResolver {
  const t = useTranslations('team.knowledge.artifacts');
  const cards = useRef(new Map<string, Card>());
  const asked = useRef(new Set<string>());
  const [, setVersion] = useState(0);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  });
  const ids = targets.map((raw) => parseWikiTarget(raw).title).filter((title) => title.startsWith(ARTIFACT_EMBED)).map((title) => title.slice(ARTIFACT_EMBED.length));
  const key = ids.join('\n');
  useEffect(() => {
    for (const id of key ? key.split('\n') : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      api<Schemas['ArtifactDetail']>(`teams/${encodeURIComponent(teamId)}/artifacts/${encodeURIComponent(id)}`).then(
        (a) => cards.current.set(id, { title: a.title, kind: a.kind.toUpperCase() }),
        () => cards.current.set(id, 'missing'),
      ).finally(() => {
        setVersion((n) => n + 1);
        loaded.current();
      });
    }
  }, [teamId, key]);
  return useCallback<ArtifactResolver>(
    (id) => {
      const card = cards.current.get(id);
      if (card === 'missing') return { href: '#', title: t('missing'), note: '', missing: true };
      return { href: `/teams/${teamId}/artifacts/${id}`, title: card?.title ?? t('loading'), note: card?.kind ?? '', missing: false };
    },
    // t words in the reader's language, which does not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId],
  );
}

/** Chooses one of the reader's artifacts to embed. */
export function ArtifactPicker({ teamId, onPick, onClose }: { teamId: string; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTranslations('team.knowledge.artifacts');
  const [list, setList] = useState<Schemas['ArtifactSummary'][] | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState('');
  useEffect(() => {
    let live = true;
    const base = `teams/${encodeURIComponent(teamId)}/artifacts`;
    Promise.all([api<Schemas['ArtifactList']>(`${base}?list=mine`), api<Schemas['ArtifactList']>(`${base}?list=shared`)]).then(
      ([mine, shared]) => live && setList([...mine.artifacts, ...shared.artifacts]),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [teamId]);
  const q = query.trim().toLocaleLowerCase();
  const shown = (list ?? []).filter((a) => !q || a.title.toLocaleLowerCase().includes(q));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pickTitle')}</DialogTitle>
          <DialogDescription>{t('pickNote')}</DialogDescription>
        </DialogHeader>
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('find')} aria-label={t('find')} autoFocus />
        <ul role="listbox" aria-label={t('pickTitle')} className="flex max-h-72 flex-col overflow-y-auto">
          {list === null && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('loading')}</li>}
          {list && shown.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('none')}</li>}
          {shown.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={chosen === a.id}
                onClick={() => setChosen(a.id)}
                onDoubleClick={() => onPick(a.id)}
                className={cn('flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm', chosen === a.id ? 'bg-accent' : 'hover:bg-accent/50')}
              >
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                <span className="text-xs text-muted-foreground">{a.kind.toUpperCase()}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={!chosen} onClick={() => onPick(chosen)}>{t('embed')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
