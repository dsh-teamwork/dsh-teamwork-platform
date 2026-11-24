import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { toolKey, type ConversationItem, type FileTarget, type Row, type ToolStatus } from '@dsh-teamwork/relay-client';
import { baseName, fileExtension, FileTypeIcon } from '@/components/file-type-icon';
import { cn } from '@/lib/utils';
import { SessionMarkdown } from './session-markdown';

type Delivered = Extract<Row, { kind: 'deliverable' }>;

/** A conversation laid out with each turn's tail: the files it changed and delivered, after its last row. */
export type TurnEntry = { kind: 'row'; row: Row } | { kind: 'tail'; turn: number; delivered: Delivered[]; changed: string[] };

/** The files each turn wrote or edited, in the order it first touched them, from its finished tool calls. */
export function changedFilesByTurn(items: readonly ConversationItem[]): Map<number, string[]> {
  const turns = new Map<number, string[]>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.turn === undefined || item.status !== 'done') continue;
    const key = toolKey(item.name);
    const path = item.file?.path ?? item.summary;
    if ((key !== 'tools.write' && key !== 'tools.edit') || !path) continue;
    const files = turns.get(item.turn) ?? [];
    if (!files.includes(path)) files.push(path);
    turns.set(item.turn, files);
  }
  return turns;
}

function turnOf(row: Row): number | undefined {
  if (row.kind === 'steps') return row.entries[0]?.turn;
  if (row.kind === 'deliverable') return row.turn;
  if (row.kind === 'work') return Number(row.id.slice('work-'.length));
  return undefined;
}

/**
 * Gathers each turn's files at its end, as DSH's turn tail does (`ui-deliverables`): what it delivered, as one group
 * where `rowsOf` placed them, and what it changed once the turn has `ended`; both go after the turn's last row,
 * before the next message.
 */
export function turnTails(rows: readonly Row[], ended: ReadonlySet<number>, changed: ReadonlyMap<number, string[]>): TurnEntry[] {
  const out: TurnEntry[] = [];
  let open: { turn: number; delivered: Delivered[] } | null = null;
  const flush = () => {
    if (!open) return;
    const files = ended.has(open.turn) ? changed.get(open.turn) ?? [] : [];
    if (open.delivered.length || files.length) out.push({ kind: 'tail', turn: open.turn, delivered: open.delivered, changed: files });
    open = null;
  };
  for (const row of rows) {
    const turn = turnOf(row);
    if (row.kind === 'user' || (turn !== undefined && open && open.turn !== turn)) flush();
    if (turn !== undefined && !open) open = { turn, delivered: [] };
    if (row.kind === 'deliverable') {
      open!.delivered.push(row);
      continue;
    }
    out.push({ kind: 'row', row });
  }
  flush();
  return out;
}

/** DSH shows four cards and folds the rest under "All N files". */
const FOLDED = 4;

/**
 * A turn's files, drawn as DSH's: the files it changed in one card, then the files it delivered as 60px cards, two
 * to a row where there is room (one alone takes the row), each previewing its file in the sidebar.
 */
export function TurnFiles({ delivered, changed, openFile }: { delivered: readonly Delivered[]; changed: readonly string[]; openFile?: (file: FileTarget) => void }) {
  const t = useTranslations('team.dsh');
  const [all, setAll] = useState(false);
  const shown = all ? delivered : delivered.slice(0, FOLDED);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {changed.length > 0 && <ChangedFiles files={changed} openFile={openFile} />}
      {delivered.length > 0 && (
        <div className="@container flex min-w-0 flex-col gap-4">
          <div className={cn('grid min-w-0 gap-2.5', delivered.length > 1 && '@min-[621px]:grid-cols-2')}>
            {shown.map((row) => <FileCard key={row.id} path={row.file.path} description={describe(row)} openFile={openFile && (() => openFile(row.file))} />)}
          </div>
          {delivered.length > FOLDED && (
            <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
              className="inline-flex items-center gap-1 self-center rounded-lg px-2.5 py-px text-xs text-muted-foreground hover:bg-accent">
              {all ? t('filesCollapse') : t('filesAll', { count: delivered.length })}
              {all ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The agent's words for a file, less a trailing aside in brackets, else its extension, as DSH words a card. */
function describe(row: Delivered): string | undefined {
  const text = row.description?.replace(/\s*[（(][^（()）]*[)）]\s*$/, '').trim();
  return text || fileExtension(row.file.path).toUpperCase() || undefined;
}

function FileCard({ path, description, openFile }: { path: string; description?: string; openFile?: () => void }) {
  const t = useTranslations('team.dsh');
  return (
    <button type="button" disabled={!openFile} onClick={openFile} title={path}
      className="group/card flex h-[60px] min-w-0 items-center gap-2.5 rounded-xl border-[0.5px] border-border bg-muted px-2.5 py-2 text-start transition-colors duration-[120ms] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-border bg-background/50">
        <FileTypeIcon path={path} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] leading-5 font-medium">{baseName(path)}</span>
        <span className="truncate text-[10px] leading-4 text-muted-foreground">
          <span className={cn(openFile && 'group-hover/card:hidden')}>{description || t('file')}</span>
          {openFile && <span className="hidden group-hover/card:inline">{t('previewInSidebar')}</span>}
        </span>
      </span>
    </button>
  );
}

/** What a turn wrote or edited: one file by name, or several by count and then by path, four before a fold. */
function ChangedFiles({ files, openFile }: { files: readonly string[]; openFile?: (file: FileTarget) => void }) {
  const t = useTranslations('team.dsh');
  const [all, setAll] = useState(false);
  if (files.length === 1) {
    return <FileCard path={files[0]!} description={t('edited')} openFile={openFile && (() => openFile({ path: files[0]! }))} />;
  }
  const shown = all ? files : files.slice(0, FOLDED);
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-muted">
      <div className="flex h-[60px] items-center gap-2.5 px-2.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-border bg-background/50">
          <FileTypeIcon kind="code" size={20} />
        </span>
        <span className="text-[13px] font-medium">{t('filesChanged', { count: files.length })}</span>
      </div>
      <ul className="flex flex-col border-t-[0.5px] border-border py-1">
        {shown.map((path) => (
          <li key={path}>
            <button type="button" disabled={!openFile} onClick={() => openFile?.({ path })} title={path}
              className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-secondary disabled:opacity-60">
              <FileTypeIcon path={path} size={14} />
              <span className="truncate font-mono">{path}</span>
            </button>
          </li>
        ))}
      </ul>
      {files.length > FOLDED && (
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
          className="flex items-center justify-center gap-1 border-t-[0.5px] border-border py-1.5 text-xs text-muted-foreground hover:bg-secondary">
          {all ? t('filesCollapse') : t('filesAll', { count: files.length })}
        </button>
      )}
    </div>
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
