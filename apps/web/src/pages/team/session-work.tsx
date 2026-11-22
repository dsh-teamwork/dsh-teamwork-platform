import { ChevronRight, FileText } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { directoryName, type FileTarget, type Row, type ToolStatus } from '@dsh-teamwork/relay-client';
import { cn } from '@/lib/utils';
import { SessionMarkdown } from './session-markdown';

export function DeliverableCard({ row, openFile }: { row: Extract<Row, { kind: 'deliverable' }>; openFile?: (file: FileTarget) => void }) {
  const t = useTranslations('team.dsh');
  return (
    <button type="button" disabled={!openFile} onClick={() => openFile?.(row.file)}
      className="flex max-w-md items-center gap-3 self-start rounded-lg border px-3 py-2.5 text-start disabled:opacity-60">
      <FileText aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="block font-medium">{directoryName(row.file.path)}</span>
        <span className="block text-xs text-muted-foreground">{row.description || t('openDeliverable')}</span>
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
