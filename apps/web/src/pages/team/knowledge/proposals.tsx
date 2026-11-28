/**
 * Proposals (`/teams/{teamId}/knowledge/proposals[/{proposalId}]`): the
 * changes to documents not yet in them (docs/tech/knowledge.md, "Rules").
 * The list holds those to the spaces the reader edits and the reader's own,
 * pending first; an agent's carries its computer, and one on a version that
 * is no longer current is marked stale. Opening one shows its difference
 * from the version it started from, a text difference, and the files its
 * text names, resolved against the document's attachments, those it names
 * newly marked; an editor accepts it as the next version or declines it
 * with a reason, and its author may withdraw it.
 */

import { ArrowLeft, Check, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import { KnowledgeDiff } from '@/components/knowledge-diff';
import { Field } from '@/components/team/field';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, type Schemas, type Team } from '@/lib/api';
import { attachmentNamesIn } from '@dsh-teamwork/shared/knowledge-format';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

import { AttachmentList } from './attachments';
import { SourceBadge } from './history';
import { personName, useNote } from './shared';

type Proposal = Schemas['KnowledgeProposal'];
type Detail = Schemas['KnowledgeProposalDetail'];

export function ProposalsView({ team, me, proposalId, onChanged }: { team: Team; me: string; proposalId: string; onChanged: () => Promise<unknown> }) {
  const base = `teams/${encodeURIComponent(team.id)}/knowledge/proposals`;
  const [state, setState] = useState<'pending' | 'all'>('pending');
  const list = useApi<{ proposals: Proposal[] }>(state === 'pending' ? `${base}?state=pending` : base);
  const changed = () => Promise.all([list.reload(), onChanged()]);
  return proposalId ? (
    <ProposalDetail team={team} me={me} proposalId={proposalId} onChanged={changed} />
  ) : (
    <ProposalList team={team} me={me} state={state} setState={setState} proposals={list.data?.proposals} error={list.error} />
  );
}

/** A proposal's state, or "stale" for a pending one on a version that is no longer current. */
function StateBadge({ p }: { p: Proposal }) {
  const t = useTranslations('team.knowledge.proposals');
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs', p.stale ? 'font-medium text-foreground' : 'text-muted-foreground')}>
      {p.stale ? t('stale') : t(`states.${p.state}`)}
    </span>
  );
}

function ProposalList({ team, me, state, setState, proposals, error }: {
  team: Team;
  me: string;
  state: 'pending' | 'all';
  setState: (state: 'pending' | 'all') => void;
  proposals?: Proposal[];
  error?: unknown;
}) {
  const t = useTranslations('team.knowledge.proposals');
  const format = useFormatter();
  const word = useTeamError();
  const note = useNote();
  const page = `/teams/${team.id}/knowledge/proposals`;
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-tight">{t('title')}</h1>
        <div role="tablist" aria-label={t('title')} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          {(['pending', 'all'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={s === state} onClick={() => setState(s)} className={cn('rounded-md px-3 py-1', s === state ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>
              {t(`lists.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t('note')}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{word(error)}</p> : null}
      {proposals?.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t(`empty.${state}`)}</p>}
      {proposals && proposals.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {proposals.map((p) => (
            <li key={p.id}>
              <Link to={`${page}/${p.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{p.documentTitle}</span>
                  <StateBadge p={p} />
                  <SourceBadge source={p.source} computer={p.computer} />
                </span>
                <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {[
                    p.author.id === me ? t('byYou') : t('by', { name: personName(p.author) }),
                    t('onVersion', { n: p.baseVersion }),
                    format.relativeTime(new Date(p.createdAt), new Date()),
                    note(p.note),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProposalDetail({ team, me, proposalId, onChanged }: { team: Team; me: string; proposalId: string; onChanged: () => Promise<unknown> }) {
  const t = useTranslations('team.knowledge.proposals');
  const format = useFormatter();
  const word = useTeamError();
  const note = useNote();
  const path = `teams/${encodeURIComponent(team.id)}/knowledge/proposals/${encodeURIComponent(proposalId)}`;
  const page = `/teams/${team.id}/knowledge`;
  const { data: p, error, reload } = useApi<Detail>(path);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [staleRefused, setStaleRefused] = useState(false);

  async function decide(action: 'accept' | 'decline' | 'withdraw', reason?: string) {
    setBusy(true);
    try {
      const done = await api<Detail>(`${path}/${action}`, { body: reason === undefined ? {} : { reason } });
      toast.success(action === 'accept' ? t('accepted', { n: done.version }) : action === 'decline' ? t('declined') : t('withdrawn'));
      setDeclining(false);
      await Promise.all([reload(), onChanged()]);
      return true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'knowledge_stale') {
        setStaleRefused(true);
        await reload();
      } else toast.error(word(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link to={`${page}/proposals`} className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {t('back')}
    </Link>
  );
  if (error) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <section className="flex flex-col gap-3">
        {back}
        <p role="alert" className="text-sm text-muted-foreground">{gone ? t('unavailable') : word(error)}</p>
      </section>
    );
  }
  if (!p) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  const mine = p.author.id === me;
  const pending = p.state === 'pending';
  return (
    <section className="flex min-w-0 flex-col gap-4">
      {back}
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            <Link to={`${page}/${p.documentId}`} className="hover:underline hover:underline-offset-4">{p.documentTitle}</Link>
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StateBadge p={p} />
            <SourceBadge source={p.source} computer={p.computer} />
            <span>{mine ? t('byYou') : t('by', { name: personName(p.author) })}</span>
            <span>· {t('onVersion', { n: p.baseVersion })}</span>
            <span>· {format.dateTime(new Date(p.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </p>
        </div>
        {pending && (
          <div className="flex flex-wrap items-center gap-2">
            {mine && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm(t('withdrawConfirm')) && void decide('withdraw')}>
                <Undo2 className="size-4" aria-hidden />
                {t('withdraw')}
              </Button>
            )}
            {p.canDecide && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
                  <X className="size-4" aria-hidden />
                  {t('decline')}
                </Button>
                <Button size="sm" disabled={busy || p.stale} onClick={() => void decide('accept')}>
                  <Check className="size-4" aria-hidden />
                  {t('accept')}
                </Button>
              </>
            )}
          </div>
        )}
      </header>
      {p.note && <p className="text-sm [overflow-wrap:anywhere]">{note(p.note)}</p>}
      {p.source === 'agent' && p.sessionId && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{t('session', { id: p.sessionId })}</p>}
      {(p.stale || staleRefused) && pending && (
        <p role="alert" className="rounded-lg border border-l-[3px] border-l-signal px-4 py-3 text-sm">{t(mine ? 'staleMine' : 'staleNote')}</p>
      )}
      {p.state === 'declined' && p.reason && <p className="rounded-lg border px-4 py-3 text-sm [overflow-wrap:anywhere]">{t('reason', { reason: p.reason })}</p>}
      {p.state === 'accepted' && p.version > 0 && (
        <p className="text-sm text-muted-foreground">
          {t.rich('acceptedAs', { n: p.version, link: (chunks) => <Link to={`${page}/${p.documentId}?version=${p.version}`} className="underline underline-offset-4">{chunks}</Link> })}
        </p>
      )}
      <KnowledgeDiff before={p.baseText} after={p.text} beforeLabel={t('baseLabel', { n: p.baseVersion })} afterLabel={t('proposedLabel')} />
      <ProposalAttachments teamId={team.id} proposal={p} />
      {declining && <DeclineDialog busy={busy} onClose={() => setDeclining(false)} onDecline={(reason) => void decide('decline', reason)} />}
    </section>
  );
}

/** The files a proposal's text names, from its document's attachments; a name its base did not give is marked new, and one with no file missing. */
function ProposalAttachments({ teamId, proposal }: { teamId: string; proposal: Detail }) {
  const t = useTranslations('team.knowledge.attachments');
  const names = attachmentNamesIn(proposal.text);
  const doc = useApi<Schemas['KnowledgeDocument']>(names.length ? `teams/${encodeURIComponent(teamId)}/knowledge/documents/${encodeURIComponent(proposal.documentId)}` : null);
  if (names.length === 0 || !doc.data) return null;
  const before = new Set(attachmentNamesIn(proposal.baseText));
  const rows = names.map((name) => ({ name, file: doc.data?.attachments.find((a) => a.name === name), tag: before.has(name) ? undefined : t('newInProposal') }));
  return <AttachmentList teamId={teamId} documentId={proposal.documentId} title={t('proposalTitle')} rows={rows} />;
}

function DeclineDialog({ busy, onClose, onDecline }: { busy: boolean; onClose: () => void; onDecline: (reason: string) => void }) {
  const t = useTranslations('team.knowledge.proposals');
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onDecline(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('declineTitle')}</DialogTitle>
            <DialogDescription>{t('declineNote')}</DialogDescription>
          </DialogHeader>
          <Field id="decline-reason" label={t('reasonLabel')}>
            <Textarea id="decline-reason" value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy || !reason.trim()}>{t('decline')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
