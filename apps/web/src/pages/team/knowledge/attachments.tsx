/**
 * A knowledge document's attachments (docs/tech/knowledge.md,
 * "Attachments"): the list under a document or a proposal, each file with its
 * size, whether the text names it and a download; and attaching, from the
 * editor's Attach button, a paste or a drop. A file goes up under its own
 * name, a pasted image under Obsidian's `Pasted image {time}.png`; a name the
 * document already holds with other bytes keeps them, so the person picks
 * another name, `diagram (2).png` offered first, and it goes up again.
 */

import { Download, FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'use-intl';

import { Field } from '@/components/team/field';
import { useTeamError } from '@/components/team/use-mutation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, uploadAttachment, type Schemas } from '@/lib/api';
import { ATTACHMENT_EXTENSIONS, attachmentNameOf, attachmentUrl, isAttachmentName, isImageName, MAX_ATTACHMENT, pastedName, suggestAttachmentName } from '@dsh-teamwork/shared/knowledge-format';
import { cn } from '@/lib/utils';

export type Attachment = Schemas['KnowledgeAttachment'];

/** Whether the server shows a file in the browser rather than downloading it: an image or a PDF. */
export const shownInline = (contentType: string) => contentType.startsWith('image/') || contentType === 'application/pdf';

/** A file's size in the reader's language: bytes, kilobytes or megabytes, as 1024s. */
export function useFileSize() {
  const format = useFormatter();
  return (bytes: number) => {
    if (bytes < 1024) return format.number(bytes, { style: 'unit', unit: 'byte', unitDisplay: 'short' });
    const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'kilobyte'] : [bytes / (1024 * 1024), 'megabyte'];
    return format.number(value, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: value < 10 ? 1 : 0 });
  };
}

/** One row of a list of attachments: a file the document holds, or a name the text gives that none has. */
export interface AttachmentRow {
  name: string;
  file?: Attachment;
  /** What the row says about the text: it names the file, it does not, or (in a proposal) it newly does. */
  tag?: string;
}

/** The files under a document or a proposal, each opened or downloaded from the document it belongs to. */
export function AttachmentList({ teamId, documentId, title, rows, children }: { teamId: string; documentId: string; title: string; rows: AttachmentRow[]; children?: ReactNode }) {
  const t = useTranslations('team.knowledge.attachments');
  const size = useFileSize();
  if (rows.length === 0 && !children) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.map(({ name, file, tag }) => {
            const href = attachmentUrl(teamId, documentId, name);
            const Icon = isImageName(name) ? ImageIcon : FileText;
            return (
              <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Icon className={cn('size-4 shrink-0', file ? 'text-muted-foreground' : 'text-destructive')} aria-hidden />
                {file ? (
                  <a
                    href={href}
                    {...(shownInline(file.contentType) ? { target: '_blank', rel: 'noopener' } : { download: name })}
                    className="min-w-0 flex-1 [overflow-wrap:anywhere] hover:underline hover:underline-offset-4"
                  >
                    {name}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 text-destructive [overflow-wrap:anywhere]">{name}</span>
                )}
                {tag && <span className="text-xs text-muted-foreground">{tag}</span>}
                {file ? (
                  <>
                    <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">{size(file.size)}</span>
                    <a href={href} download={name} aria-label={t('download', { name })} title={t('download', { name })} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                      <Download className="size-4" aria-hidden />
                    </a>
                  </>
                ) : (
                  <span className="text-xs text-destructive">{t('missing')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </section>
  );
}

/** A taken name being renamed: the name refused, the one offered, and how the person answered (null to skip the file). */
interface Renaming {
  name: string;
  suggestion: string;
  answer: (name: string | null) => void;
}

/**
 * Attaching files to one document. `attach` uploads each in turn and hands
 * every stored file to `onAttached`; `dialog` is the rename dialog, to be
 * rendered by the page while a name is taken.
 */
export function useAttach({ teamId, documentId, known, onAttached }: {
  teamId: string;
  documentId: string;
  /** The names the document holds now, so an offered name is a free one. */
  known: () => string[];
  onAttached: (file: Attachment) => void;
}) {
  const t = useTranslations('team.knowledge.attachments');
  const word = useTeamError();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Renaming | null>(null);

  /** A failed upload worded for the file: the codes the text and the file share are worded for the file. */
  const failure = (error: unknown, name: string) => {
    if (error instanceof ApiError) {
      if (error.code === 'knowledge_too_large') return t('errors.tooLarge', { name });
      if (error.code === 'invalid_request') return t('errors.invalid', { name });
    }
    return word(error);
  };

  async function one(file: File, pasted: boolean) {
    let name = pasted && file.type.startsWith('image/') ? pastedName(new Date(), file.type.slice(6).replace('jpeg', 'jpg').replace('svg+xml', 'svg')) : attachmentNameOf(file.name);
    if (!isAttachmentName(name)) {
      toast.error(t('errors.type', { name: name || file.name }));
      return;
    }
    if (file.size > MAX_ATTACHMENT) {
      toast.error(t('errors.tooLarge', { name }));
      return;
    }
    for (;;) {
      const progress = toast.loading(t('uploading', { name }));
      try {
        const { attachment } = await uploadAttachment(teamId, documentId, file, name);
        toast.success(t('attached', { name: attachment.name }), { id: progress });
        onAttached(attachment);
        return;
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'knowledge_name_taken')) {
          toast.error(failure(error, name), { id: progress });
          return;
        }
        toast.dismiss(progress);
        const refused = name;
        const next = await new Promise<string | null>((answer) => setRenaming({ name: refused, suggestion: suggestAttachmentName(refused, known()), answer }));
        setRenaming(null);
        if (next === null) return;
        name = next;
      }
    }
  }

  async function attach(files: File[], pasted: boolean) {
    setBusy(true);
    try {
      for (const file of files) await one(file, pasted);
    } finally {
      setBusy(false);
    }
  }

  const dialog = renaming && <RenameDialog key={renaming.name} renaming={renaming} />;
  return { attach, busy, dialog };
}

/** Asks for another name for a file whose name the document holds with other bytes. */
function RenameDialog({ renaming }: { renaming: Renaming }) {
  const t = useTranslations('team.knowledge.attachments');
  const [name, setName] = useState(renaming.suggestion);
  const trimmed = name.trim();
  const valid = isAttachmentName(trimmed) && attachmentNameOf(trimmed) === trimmed && trimmed !== renaming.name;
  return (
    <Dialog open onOpenChange={(open) => !open && renaming.answer(null)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) renaming.answer(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('renameTitle')}</DialogTitle>
            <DialogDescription>{t('renameNote', { name: renaming.name })}</DialogDescription>
          </DialogHeader>
          <Field id="attachment-name" label={t('nameLabel')} error={trimmed && !valid ? t('nameInvalid') : null}>
            <Input id="attachment-name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => renaming.answer(null)}>{t('skip')}</Button>
            <Button type="submit" disabled={!valid}>{t('attachAs')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Attach button and the file picker it opens. */
export function AttachButton({ busy, onFiles, picker }: { busy: boolean; onFiles: (files: File[]) => void; picker?: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations('team.knowledge.attachments');
  const own = useRef<HTMLInputElement>(null);
  const input = picker ?? own;
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={[...ATTACHMENT_EXTENSIONS].map((ext) => `.${ext}`).join(',')}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <Paperclip className="size-4" aria-hidden />
        {t('attach')}
      </Button>
    </>
  );
}
