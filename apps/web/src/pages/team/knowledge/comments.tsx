/**
 * A document's comments beside its text (docs/tech/knowledge.md, "Comments"):
 * threads, each on the words it quotes and the version it was written on,
 * with their replies. Selecting words while reading offers to open a thread
 * on them; a thread whose words the shown version no longer holds says so.
 * Resolved threads fold away until asked for. Comments are never part of the
 * text, so they change no version and an agent never reads them.
 */

import { Check, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import type { Quote } from '@/components/knowledge-comments';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { api, type Schemas } from '@/lib/api';
import { cn } from '@/lib/utils';

import { personName } from './shared';

export type Comment = Schemas['KnowledgeComment'];

/** A thread: its first comment and its replies. */
export interface Thread {
  head: Comment;
  replies: Comment[];
}

export function threadsOf(comments: Comment[]): Thread[] {
  const replies = new Map<string, Comment[]>();
  for (const c of comments) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  return comments.filter((c) => !c.parentId).map((head) => ({ head, replies: replies.get(head.id) ?? [] }));
}

/** The button that floats under selected words, to open a thread on them. */
export function QuoteButton({ quote, onComment }: { quote: Quote; onComment: () => void }) {
  const t = useTranslations('team.knowledge.comments');
  return (
    <Button
      size="sm"
      className="fixed z-40 -translate-x-1/2 shadow-md"
      style={{ top: quote.top + 6, left: quote.left }}
      // Keep the selection while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onComment}
    >
      <MessageSquare className="size-4" aria-hidden />
      {t('comment')}
    </Button>
  );
}

export function CommentsPanel({ path, version, comments, placed, active, draft, onActivate, onDraftDone, onChanged, onClose }: {
  /** The document's API path. */
  path: string;
  /** The version shown. */
  version: number;
  comments: Comment[];
  /** The threads whose words the shown text holds. */
  placed: ReadonlySet<string>;
  active: string;
  /** Words to open a thread on, chosen by selecting them. */
  draft: Quote | null;
  onActivate: (id: string) => void;
  onDraftDone: () => void;
  onChanged: () => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslations('team.knowledge.comments');
  const format = useFormatter();
  const word = useTeamError();
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const threads = threadsOf(comments);
  const open = threads.filter((th) => !th.head.resolvedAt);
  const resolved = threads.filter((th) => th.head.resolvedAt);

  async function send(body: Record<string, unknown>, done: () => void) {
    setBusy(true);
    try {
      await api(`${path}/comments`, { body });
      done();
      await onChanged();
    } catch (error) {
      toast.error(word(error));
    } finally {
      setBusy(false);
    }
  }

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      await onChanged();
    } catch (error) {
      toast.error(word(error));
    } finally {
      setBusy(false);
    }
  }

  const commentsPath = path.replace(/\/documents\/[^/]+$/, '/comments');
  const card = (th: Thread) => {
    const { head } = th;
    const here = !head.quote || placed.has(head.id);
    return (
      <li key={head.id}>
        <article
          onClick={() => onActivate(head.id)}
          className={cn('flex flex-col gap-2 rounded-lg border p-3 text-sm', head.id === active && 'border-ring', head.resolvedAt && 'opacity-70')}
        >
          {head.quote ? (
            <blockquote className={cn('border-l-2 border-signal pl-2 text-xs text-muted-foreground', !here && 'line-through')}>{head.quote}</blockquote>
          ) : (
            <p className="text-xs text-muted-foreground">{t('wholeDocument')}</p>
          )}
          {head.quote && !here && <p className="text-xs text-muted-foreground">{t('notHere', { n: head.version })}</p>}
          {[head, ...th.replies].map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{personName(c.author)}</span>
                <span className="shrink-0">{format.relativeTime(new Date(c.createdAt), new Date())}</span>
                {c.canDelete && (
                  <button
                    type="button"
                    aria-label={t('delete')}
                    className="rounded p-0.5 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(c.parentId ? t('deleteReplyConfirm') : t('deleteThreadConfirm'))) void act(() => api(`${commentsPath}/${encodeURIComponent(c.id)}`, { method: 'DELETE' }));
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{c.body}</p>
            </div>
          ))}
          {head.resolvedAt && head.resolvedBy && <p className="text-xs text-muted-foreground">{t('resolvedBy', { name: personName(head.resolvedBy) })}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!head.resolvedAt && <ReplyBox busy={busy} onSend={(body, done) => void send({ parentId: head.id, body }, done)} />}
            {head.canResolve && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void act(() => api(`${commentsPath}/${encodeURIComponent(head.id)}`, { method: 'PATCH', body: { resolved: !head.resolvedAt } }));
                }}
              >
                {head.resolvedAt ? <RotateCcw className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
                {head.resolvedAt ? t('reopen') : t('resolve')}
              </Button>
            )}
          </div>
        </article>
      </li>
    );
  };

  return (
    <aside aria-label={t('title')} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-medium">{t('titleCount', { n: open.length })}</h2>
        <Button size="icon" variant="ghost" aria-label={t('close')} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {draft ? (
        <NewThread key={`quote:${draft.quote}`} quote={draft.quote} busy={busy} onCancel={onDraftDone} onSend={(body) => void send({ version, quote: draft.quote, anchor: draft.anchor, body }, onDraftDone)} />
      ) : (
        <NewThread key="document" quote="" busy={busy} onSend={(body, done) => void send({ version, body }, done ?? (() => undefined))} />
      )}
      {open.length === 0 && !draft && <p className="text-xs text-muted-foreground">{t('none')}</p>}
      <ul className="flex flex-col gap-2">{open.map(card)}</ul>
      {resolved.length > 0 && (
        <>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? t('hideResolved') : t('showResolved', { n: resolved.length })}
          </Button>
          {showResolved && <ul className="flex flex-col gap-2">{resolved.map(card)}</ul>}
        </>
      )}
    </aside>
  );
}

/** A new thread: on chosen words, or, with none, on the whole document. */
function NewThread({ quote, busy, onSend, onCancel }: { quote: string; busy: boolean; onSend: (body: string, done?: () => void) => void; onCancel?: () => void }) {
  const t = useTranslations('team.knowledge.comments');
  const [body, setBody] = useState('');
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSend(body.trim(), () => setBody(''));
      }}
    >
      {quote && <blockquote className="border-l-2 border-signal pl-2 text-xs text-muted-foreground">{quote}</blockquote>}
      <textarea
        value={body}
        autoFocus={!!quote}
        maxLength={4000}
        rows={quote ? 3 : 2}
        onChange={(e) => setBody(e.target.value)}
        placeholder={quote ? t('placeholder') : t('placeholderDocument')}
        aria-label={t('placeholder')}
        className="w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" size="sm" variant="outline" onClick={onCancel}>{t('cancel')}</Button>}
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>{t('send')}</Button>
      </div>
    </form>
  );
}

/** A reply to a thread, one line until it is written in. */
function ReplyBox({ busy, onSend }: { busy: boolean; onSend: (body: string, done: () => void) => void }) {
  const t = useTranslations('team.knowledge.comments');
  const [body, setBody] = useState('');
  return (
    <form
      className="flex min-w-0 flex-1 gap-2"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSend(body.trim(), () => setBody(''));
      }}
    >
      <input
        value={body}
        maxLength={4000}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('reply')}
        aria-label={t('reply')}
        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {body.trim() && <Button type="submit" size="sm" disabled={busy}>{t('send')}</Button>}
    </form>
  );
}
