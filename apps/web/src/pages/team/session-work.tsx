import { ChevronRight, File, FileArchive, FileCode, FileImage, FileSpreadsheet, FileText, Presentation, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { useTranslations } from 'use-intl';

import { directoryName, type FileTarget, type Row, type ToolStatus } from '@dsh-teamwork/relay-client';
import { cn } from '@/lib/utils';
import { SessionMarkdown } from './session-markdown';

/** What a file is, told by its extension, as its card's icon: a deck, a sheet and a document should not look alike. */
const KINDS: [RegExp, LucideIcon][] = [
  [/\.(pptx?|key|odp)$/i, Presentation],
  [/\.(xlsx?|csv|tsv|ods|numbers)$/i, FileSpreadsheet],
  [/\.(pdf|docx?|odt|rtf|md|txt|pages)$/i, FileText],
  [/\.(png|jpe?g|gif|webp|svg|avif|heic)$/i, FileImage],
  [/\.(zip|tar|gz|tgz|7z|rar)$/i, FileArchive],
  [/\.(html?|css|[cm]?[jt]sx?|json|ya?ml|py|go|rs|sh|sql)$/i, FileCode],
];

function fileIcon(path: string): LucideIcon {
  return KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? File;
}

/** A file the session delivered: one width for every card, so a run of them lines up, and its kind on a tile. */
export function DeliverableCard({ row, openFile }: { row: Extract<Row, { kind: 'deliverable' }>; openFile?: (file: FileTarget) => void }) {
  const t = useTranslations('team.dsh');
  return (
    <button type="button" disabled={!openFile} onClick={() => openFile?.(row.file)} title={row.file.path}
      className="flex w-full max-w-md items-center gap-3 self-start rounded-lg border bg-card px-3 py-2.5 text-start hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 disabled:hover:bg-card">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        {createElement(fileIcon(row.file.path), { 'aria-hidden': true, className: 'size-5' })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{directoryName(row.file.path)}</span>
        <span className="block truncate text-xs text-muted-foreground">{row.description || t('openDeliverable')}</span>
      </span>
    </button>
  );
}

export function WorkToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle(): void }) {
  const t = useTranslations('team.dsh');
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ChevronRight aria-hidden className={cn('size-4', open && 'rotate-90')} />
      {count ? t('workDetails', { count }) : t('thinkingWorkDetails')}
    </button>
  );
}

export function SessionSteps({ row, openFile }: { row: Extract<Row, { kind: 'steps' }>; openFile?: (file: FileTarget) => void }) {
  const t = useTranslations('team.dsh');
  const status = (value: ToolStatus) => t(value === 'done' ? 'stepDone' : value);
  return (
    <details className="min-w-0 rounded-md border px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">{row.count ? t('steps', { count: row.count }) : t('reasoningLabel')} · {status(row.status)}</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {row.entries.map((tool) => {
          if (tool.kind === 'reasoning') {
            return <li key={tool.id}><details>
              <summary className="cursor-pointer">{t('reasoningDetails')}</summary>
              <div className="mt-1 border-s-2 ps-2"><SessionMarkdown text={tool.text} passive /></div>
            </details></li>;
          }
          const { file, detail } = tool;
          const target = file?.line ? `${file.path}:${file.line}` : file?.path ?? tool.summary;
          return (
            <li key={tool.id} className="min-w-0 [overflow-wrap:anywhere]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-foreground">{tool.name}</span>
                <span>{status(tool.status)}</span>
                {detail?.exitCode !== undefined && <span>{t('exitCode', { code: detail.exitCode })}</span>}
              </div>
              {file && openFile ? (
                <button type="button" className="max-w-full cursor-pointer text-start font-mono underline decoration-dotted underline-offset-2" onClick={() => openFile(file)}>
                  {target}
                </button>
              ) : target && <p className="whitespace-pre-wrap font-mono">{target}</p>}
              {detail?.output && (
                <details className="mt-1">
                  <summary className="cursor-pointer">{t('stepOutput')}</summary>
                  <pre className="mt-1 max-h-52 overflow-auto rounded bg-muted p-2 text-foreground">{detail.output}</pre>
                  {detail.truncated && <p className="mt-1">{t('stepOutputTruncated')}</p>}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
