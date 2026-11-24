/**
 * One knowledge document (`/teams/{teamId}/knowledge/{documentId}`): shown
 * read-only by the editor, a chosen version with `?version=`, its history with
 * `?history`, and a version against the one before it with `?compare=`.
 *
 * Edit opens the same text in the editor. An editor's save is a new version
 * on the version being edited; a reader's is a proposal for an editor to
 * decide. The first save of a document the editor would rewrite records that
 * normalisation as its own version first (lib/knowledge-format.ts,
 * `planSave`). A save on a version that is no longer current keeps what the
 * person typed, reads the current version and offers the difference before
 * they save again on top of it; nothing they typed is dropped, and leaving
 * the page with unsaved changes asks first.
 *
 * While editing, Attach, a paste or a drop uploads a file to the document
 * and puts `![[name]]` (an image) or `[[name]]` at the cursor. Every version,
 * the current one or an old one, draws its embeds from the document's
 * attachments, listed under the text with which ones it names.
 */

import { ArrowLeft, Copy, FolderInput, History, Pencil, Trash2, Type } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import { KnowledgeDiff } from '@/components/knowledge-diff';
import { KnowledgeEditor, type AttachmentResolver, type KnowledgeEditorHandle } from '@/components/knowledge-editor';
import { Field } from '@/components/team/field';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, ApiError, type Schemas, type Team } from '@/lib/api';
import { attachmentUrl, isAttachmentName, isImageName, parseWikiTarget, planSave, splitFrontMatter } from '@/lib/knowledge-format';
import { findDocument, folderPaths, resolveWikiLink, type KnowledgeTree } from '@/lib/knowledge-tree';
import { useApi } from '@/lib/use-api';

import { AttachButton, AttachmentList, shownInline, useAttach, useFileSize, type Attachment } from './attachments';
import { CompareView, HistoryList, SourceBadge } from './history';
import { ActionMenu, NameDialog, personName } from './shared';

type Doc = Schemas['KnowledgeDocument'];

/** A document open in the editor. */
interface Editing {
  /** The version the save goes on top of. */
  base: number;
  /** That version's text. */
  stored: string;
  frontMatter: string;
  /** What the editor opened with: the stored body, or after a conflict still the person's own text. */
  body: string;
  /** The stored text as the editor would save it with no edit, once it has loaded; unset after a conflict, when the body is no longer the stored one. */
  normalised?: string;
  /** A save was refused on a stale version: the current one, and whether the person chose to save on top of it. */
  conflict?: { current: Doc; mine: string; rebased: boolean };
}

export function DocumentView({ team, tree, documentId, onTreeChanged }: {
  team: Team;
  tree: KnowledgeTree;
  documentId: string;
  onTreeChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('team.knowledge.document');
  const format = useFormatter();
  const word = useTeamError();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const version = Number(params.get('version')) || 0;
  const compare = Number(params.get('compare')) || 0;
  const showHistory = params.has('history');
  const teamPath = `teams/${encodeURIComponent(team.id)}/knowledge`;
  const path = `${teamPath}/documents/${encodeURIComponent(documentId)}`;
  const page = `/teams/${team.id}/knowledge`;
  const { data: doc, error, reload } = useApi<Doc>(version ? `${path}?version=${version}` : path);
  const editor = useRef<KnowledgeEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState<'note' | 'rename' | 'move' | null>(null);
  const [showConflict, setShowConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const where = findDocument(tree, documentId);
  const spaceId = where?.space.id ?? doc?.spaceId ?? '';
  const resolve = useCallback(
    (raw: string) => {
      const link = resolveWikiLink(tree, raw, { spaceId, documentId });
      return link ? `${page}/${link.documentId}${link.anchor ? `#${link.anchor}` : ''}` : null;
    },
    [tree, spaceId, documentId, page],
  );
  const body = useMemo(() => (doc ? splitFrontMatter(doc.text).body : ''), [doc]);

  // The document's files: what it was read with, and what this page uploaded since. A ref as well, so a link
  // inserted right after its upload already draws the file.
  const [added, setAdded] = useState<Attachment[]>([]);
  const files = useMemo(() => {
    const byName = new Map<string, Attachment>();
    for (const a of [...(doc?.attachments ?? []), ...added]) byName.set(a.name, a);
    return byName;
  }, [doc, added]);
  const known = useRef(files);
  known.current = files;
  const size = useFileSize();
  const attachment = useCallback<AttachmentResolver>(
    (name) => {
      const file = known.current.get(name);
      return file ? { href: attachmentUrl(team.id, documentId, name), inline: shownInline(file.contentType), size: size(file.size) } : null;
    },
    // `size` words in the reader's language, which does not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [team.id, documentId],
  );
  const [linked, setLinked] = useState<string[]>([]);
  const { attach, busy: attaching, dialog: attachDialog } = useAttach({
    teamId: team.id,
    documentId,
    known: () => [...known.current.keys()],
    onAttached: (file) => {
      known.current = new Map(known.current).set(file.name, file);
      setAdded((list) => [...list.filter((a) => a.name !== file.name), file]);
      editor.current?.insert(file.name, isImageName(file.name));
      editor.current?.redraw();
    },
  });
  const current = doc && doc.version === doc.currentVersion;

  const edit = useCallback((d: Doc) => {
    const { frontMatter, body } = splitFrontMatter(d.text);
    setEditing({ base: d.version, stored: d.text, frontMatter, body });
    setParams({}, { replace: true });
  }, [setParams]);

  // A document just made opens ready to write in.
  const startEdit = (location.state as { edit?: boolean } | null)?.edit === true;
  useEffect(() => {
    if (startEdit && doc && !editing && doc.canEdit && doc.version === doc.currentVersion) {
      edit(doc);
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [startEdit, doc, editing, edit, navigate, location.pathname]);

  const mine = () => (editing ? editing.frontMatter + (editor.current?.markdown() ?? editing.body) : '');
  const dirty = () => {
    if (!editing) return false;
    const text = mine();
    return text !== editing.stored && text !== editing.normalised;
  };
  // Leaving with unsaved changes asks first, inside the console and out of it.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && dirty());
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(t('leaveConfirm'))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);
  useEffect(() => {
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  // A citation or a `[[Document#Heading]]` link opens at its heading.
  useEffect(() => {
    if (!doc || editing || !location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(timer);
  }, [doc, editing, location.hash]);

  async function save(text: string) {
    if (!editing || !doc) return;
    const edited = mine();
    setSaving(true);
    try {
      if (doc.canEdit) {
        const plan = planSave(editing.stored, editing.normalised ?? editing.stored, edited, text);
        if (plan.length === 0) {
          toast.message(t('nothingChanged'));
        } else {
          let base = editing.base;
          for (const step of plan) {
            const saved = await api<Doc>(`${path}/versions`, { body: { baseVersion: base, text: step.text, note: step.note } });
            base = saved.currentVersion;
          }
          toast.success(plan.length > 1 ? t('savedFormatted', { n: base }) : t('saved', { n: base }));
        }
      } else if (edited === editing.stored) {
        toast.message(t('nothingChanged'));
      } else {
        await api(`${path}/proposals`, { body: { baseVersion: editing.base, text: edited, note: text } });
        toast.success(t('proposed'), { description: t('proposedNote') });
      }
      setEditing(null);
      setAsking(null);
      setShowConflict(false);
      setParams({}, { replace: true });
      await Promise.all([reload(), onTreeChanged()]);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'knowledge_stale') {
        setAsking(null);
        try {
          const latest = await api<Doc>(path);
          setEditing({ ...editing, conflict: { current: latest, mine: edited, rebased: false } });
          setShowConflict(false);
        } catch (again) {
          toast.error(word(again));
        }
      } else {
        toast.error(word(error));
      }
    } finally {
      setSaving(false);
    }
  }

  // Saving on top of the version that is current now: the text in the editor stays the person's.
  function rebase() {
    if (!editing?.conflict) return;
    const latest = editing.conflict.current;
    setEditing({ ...editing, base: latest.version, stored: latest.text, normalised: undefined, conflict: { ...editing.conflict, rebased: true } });
  }

  function cancel() {
    if (dirty() && !window.confirm(t('discardConfirm'))) return;
    setEditing(null);
    setShowConflict(false);
    void reload();
  }

  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await run();
      toast.success(success);
    } catch (error) {
      toast.error(word(error));
    } finally {
      setBusy(false);
    }
  }

  async function restore(n: number) {
    if (!window.confirm(t('restoreConfirm', { n }))) return;
    await act(async () => {
      await api(`${path}/versions/${n}/restore`, { method: 'POST' });
      setParams({}, { replace: true });
      await Promise.all([reload(), onTreeChanged()]);
    }, t('restored', { n }));
  }

  async function remove() {
    if (!doc || !window.confirm(t('deleteConfirm', { title: doc.title }))) return;
    await act(async () => {
      await api(path, { method: 'DELETE' });
      await onTreeChanged();
      void navigate(page);
    }, t('deleted', { title: doc.title }));
  }

  if (error) {
    const gone = error instanceof ApiError && error.status === 404;
    return <p role="alert" className="text-sm text-muted-foreground">{gone ? t('unavailable') : word(error)}</p>;
  }
  if (!doc) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  const space = where?.space;
  const folders = space ? folderPaths(space) : [];
  const folder = folders.find((f) => f.id === doc.folderId);
  const latest = doc.versions.find((v) => v.number === doc.version);
  const viewing = (next: Record<string, string>) => setParams(next);

  return (
    <article className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          {/* The title closes the path: a document's text usually opens with it as a heading already. */}
          <h1 className="text-sm [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">{[space?.name, ...(folder?.path ?? []), ''].filter((s) => s !== undefined).join(' / ')}</span>
            <span className="font-medium">{doc.title}</span>
          </h1>
          {latest && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t('versionLine', { n: latest.number, name: personName(latest.author), at: format.relativeTime(new Date(latest.createdAt), new Date()) })}</span>
              <SourceBadge source={latest.source} />
            </p>
          )}
        </div>
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <AttachButton busy={attaching} picker={picker} onFiles={(chosen) => void attach(chosen, false)} />
            <Button variant="outline" size="sm" disabled={saving} onClick={cancel}>{t('cancel')}</Button>
            <Button size="sm" disabled={saving || (editing.conflict && !editing.conflict.rebased)} onClick={() => setAsking('note')}>
              {doc.canEdit ? t('save') : t('propose')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {current && !compare && !showHistory && (
              <Button size="sm" onClick={() => edit(doc)}>
                <Pencil className="size-4" aria-hidden />
                {t('edit')}
              </Button>
            )}
            <Button size="sm" variant={showHistory ? 'secondary' : 'outline'} onClick={() => viewing(showHistory ? {} : { history: '' })}>
              <History className="size-4" aria-hidden />
              {t('history')}
            </Button>
            <ActionMenu
              label={t('more')}
              items={[
                {
                  label: t('copyLink'),
                  icon: <Copy className="size-4" aria-hidden />,
                  onSelect: () => void navigator.clipboard.writeText(`${window.location.origin}${page}/${doc.id}`).then(() => toast.success(t('copied'))),
                },
                ...(doc.canEdit
                  ? [
                      { label: t('rename'), icon: <Type className="size-4" aria-hidden />, onSelect: () => setAsking('rename') },
                      { label: t('move'), icon: <FolderInput className="size-4" aria-hidden />, onSelect: () => setAsking('move') },
                      { label: t('delete'), icon: <Trash2 className="size-4" aria-hidden />, onSelect: () => void remove(), destructive: true },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </header>

      {editing && !doc.canEdit && <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">{t('readerEditing')}</p>}
      {editing?.conflict && (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-l-[3px] border-l-signal px-4 py-3 text-sm">
          <p>
            {editing.conflict.rebased
              ? t('rebased', { n: editing.conflict.current.version })
              : t('stale', { n: editing.conflict.current.version, name: personName(editing.conflict.current.versions.find((v) => v.number === editing.conflict?.current.version)?.author ?? { id: '', name: null, email: null }) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowConflict(!showConflict)}>{showConflict ? t('hideDifference') : t('showDifference')}</Button>
            {!editing.conflict.rebased && <Button size="sm" onClick={rebase}>{t('rebase', { n: editing.conflict.current.version })}</Button>}
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(mine()).then(() => toast.success(t('copiedText')))}>{t('copyMine')}</Button>
          </div>
          {showConflict && (
            <KnowledgeDiff before={editing.conflict.current.text} after={mine()} beforeLabel={t('theirs', { n: editing.conflict.current.version })} afterLabel={t('yours')} />
          )}
        </div>
      )}

      {!editing && version > 0 && version !== doc.currentVersion && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">{t('oldVersion', { n: version, current: doc.currentVersion })}</span>
          <Button size="sm" variant="outline" onClick={() => viewing({ compare: String(version) })} disabled={version < 2}>{t('compare')}</Button>
          {doc.canEdit && <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(version)}>{t('restore')}</Button>}
          <Link to={`${page}/${doc.id}`} className="text-sm underline underline-offset-4">{t('toCurrent')}</Link>
        </div>
      )}

      {!editing && (showHistory || compare > 0) ? (
        <div className="flex flex-col gap-4">
          {compare > 0 && (
            <button type="button" onClick={() => viewing({ history: '' })} className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden />
              {t('backToHistory')}
            </button>
          )}
          {compare > 0 ? (
            <CompareView path={path} n={compare} />
          ) : (
            <HistoryList doc={doc} busy={busy} onView={(n) => viewing(n === doc.currentVersion ? {} : { version: String(n) })} onCompare={(n) => viewing({ compare: String(n) })} onRestore={(n) => void restore(n)} />
          )}
        </div>
      ) : (
        <KnowledgeEditor
          key={editing ? 'edit' : `read-${doc.version}`}
          ref={editor}
          body={editing ? editing.body : body}
          readOnly={!editing}
          resolve={resolve}
          attachment={attachment}
          onLinks={setLinked}
          onFiles={editing ? (dropped, pasted) => void attach(dropped, pasted) : undefined}
          onAttach={editing ? () => picker.current?.click() : undefined}
          onNavigate={(href) => void navigate(href)}
          label={doc.title}
          onReady={(normalisedBody) => {
            // Only the stored text has a normalisation to record; after a conflict the editor holds the person's own.
            setEditing((e) => (e && !e.conflict ? { ...e, normalised: e.frontMatter + normalisedBody } : e));
          }}
          className={editing ? 'min-h-[50vh] rounded-lg border px-5 py-4' : undefined}
        />
      )}
      {!showHistory && !compare && <DocumentAttachments teamId={team.id} documentId={documentId} files={files} linked={linked} editing={!!editing} />}
      {attachDialog}

      {asking === 'note' && editing && (
        <SaveDialog proposal={!doc.canEdit} busy={saving} onClose={() => setAsking(null)} onSave={(text) => void save(text)} />
      )}
      {asking === 'rename' && (
        <NameDialog
          title={t('renameTitle')}
          label={t('titleLabel')}
          initial={doc.title}
          max={120}
          action={t('rename')}
          onClose={() => setAsking(null)}
          submit={async (title) => {
            await api(path, { method: 'PATCH', body: { title } });
            await Promise.all([reload(), onTreeChanged()]);
          }}
        />
      )}
      {asking === 'move' && (
        <MoveDialog
          folders={folders}
          from={doc.folderId}
          onClose={() => setAsking(null)}
          submit={async (folderId) => {
            await api(path, { method: 'PATCH', body: { folderId } });
            await Promise.all([reload(), onTreeChanged()]);
          }}
        />
      )}
    </article>
  );
}

/** Asks for the save's one-line note; a reader's save says it becomes a proposal. */
function SaveDialog({ proposal, busy, onClose, onSave }: { proposal: boolean; busy: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const t = useTranslations('team.knowledge.document');
  const [text, setText] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(text.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{proposal ? t('proposeTitle') : t('saveTitle')}</DialogTitle>
            <DialogDescription>{proposal ? t('proposeNote') : t('saveNote')}</DialogDescription>
          </DialogHeader>
          <Field id="knowledge-note" label={t('noteLabel')} hint={t('noteHint')}>
            <Input id="knowledge-note" value={text} maxLength={200} autoFocus onChange={(e) => setText(e.target.value)} placeholder={t('notePlaceholder')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy}>{proposal ? t('propose') : t('save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Moves a document to another folder of its space, or to its root. */
function MoveDialog({ folders, from, onClose, submit }: { folders: { id: string; path: string[] }[]; from: string; onClose: () => void; submit: (folderId: string) => Promise<unknown> }) {
  const t = useTranslations('team.knowledge.document');
  const word = useTeamError();
  const [to, setTo] = useState(from);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const options = [{ value: '', label: t('spaceRoot') }, ...folders.map((f) => ({ value: f.id, label: f.path.join(' / ') }))];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('moveTitle')}</DialogTitle>
          <DialogDescription>{t('moveNote')}</DialogDescription>
        </DialogHeader>
        <Select label={t('moveTo')} value={to} options={options} change={setTo} className="w-full" />
        {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button
            disabled={busy || to === from}
            onClick={() => {
              setBusy(true);
              setFailed(null);
              submit(to).then(onClose, (error: unknown) => setFailed(word(error))).finally(() => setBusy(false));
            }}
          >
            {t('move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The document's files under its text, and the names the text gives that no file has; which ones the text names is read as it is edited. */
function DocumentAttachments({ teamId, documentId, files, linked, editing }: { teamId: string; documentId: string; files: Map<string, Attachment>; linked: string[]; editing: boolean }) {
  const t = useTranslations('team.knowledge.attachments');
  const named = new Set(linked.map((raw) => parseWikiTarget(raw).title).filter(isAttachmentName));
  const rows = [
    ...[...files.values()].map((file) => ({ name: file.name, file, tag: named.has(file.name) ? t('named') : t('unnamed') })),
    ...[...named].filter((name) => !files.has(name)).map((name) => ({ name })),
  ];
  return (
    <AttachmentList teamId={teamId} documentId={documentId} title={t('title')} rows={rows}>
      {editing && <p className="text-xs text-muted-foreground">{t('editingNote')}</p>}
    </AttachmentList>
  );
}
