import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';

import type { ConversationItem, FileDiff, FileTarget, Row, ToolStatus, TurnChanges } from '@dsh-teamwork/relay-client';
import { baseName, fileExtension, FileTypeIcon } from '@/components/file-type-icon';
import { cn } from '@/lib/utils';
import { SessionMarkdown } from './session-markdown';

type Delivered = Extract<Row, { kind: 'deliverable' }>;

/** A conversation laid out with each turn's tail: the files it changed and delivered, after its last row. */
export type TurnEntry = { kind: 'row'; row: Row } | { kind: 'tail'; turn: number; delivered: Delivered[]; changes?: number };

/** Each turn's latest `workspace/changes` sequence: DSH replaces a turn's summary with every later one. */
export function changesByTurn(items: readonly ConversationItem[]): Map<number, number> {
  const turns = new Map<number, number>();
  for (const item of items) {
    if (item.kind === 'changes' && item.seq > (turns.get(item.turn) ?? -1)) turns.set(item.turn, item.seq);
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
 * where `rowsOf` placed them, and what it changed (the sequence of DSH's summary) once the turn has `ended`; both go
 * after the turn's last row, before the next message.
 */
export function turnTails(rows: readonly Row[], ended: ReadonlySet<number>, changes: ReadonlyMap<number, number>): TurnEntry[] {
  const out: TurnEntry[] = [];
  let open: { turn: number; delivered: Delivered[] } | null = null;
  const flush = () => {
    if (!open) return;
    const seq = ended.has(open.turn) ? changes.get(open.turn) : undefined;
    if (open.delivered.length || seq !== undefined) out.push({ kind: 'tail', turn: open.turn, delivered: open.delivered, ...(seq !== undefined ? { changes: seq } : {}) });
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

/** Where a turn's changes come from, and where they open: the computer's record, and the sidebar's review of it. */
export interface ChangesSource {
  load(seq: number): Promise<TurnChanges>;
  diff(seq: number, index: number): Promise<FileDiff>;
  open(seq: number, turn: number, index: number): void;
}

/** DSH shows four cards and folds the rest under "All N files". */
const FOLDED = 4;

/**
 * A turn's files, drawn as DSH's: the files it changed in one card, then the files it delivered as 60px cards, two
 * to a row where there is room (one alone takes the row), each previewing its file in the sidebar.
 */
export function TurnFiles({ turn, delivered, changes, source, openFile }: {
  turn: number;
  delivered: readonly Delivered[];
  /** The sequence of DSH's summary of the turn's changes, when it made one. */
  changes?: number;
  source?: ChangesSource;
  openFile?: (file: FileTarget) => void;
}) {
  const t = useTranslations('team.dsh');
  const [all, setAll] = useState(false);
  const shown = all ? delivered : delivered.slice(0, FOLDED);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {changes !== undefined && source && <ChangedFiles turn={turn} seq={changes} source={source} />}
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

function FileCard({ path, description, openFile }: { path: string; description?: ReactNode; openFile?: () => void }) {
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

/** A file's added and deleted lines, as DSH counts them. */
export function LineCounts({ added, deleted }: { added: number; deleted: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-success">+{added}</span> <span className="text-destructive">−{deleted}</span>
    </span>
  );
}

/** How long a pointer rests on a changed file before its comparison shows, as DSH waits. */
const HOVER_DELAY = 500;

/**
 * What a turn changed, from DSH's own record of it: one file as a card with its counts, or several as a card with
 * the totals and a row per file, four before a fold. Resting on a row shows its comparison; a click opens the turn's
 * review in the sidebar at that file.
 */
function ChangedFiles({ turn, seq, source }: { turn: number; seq: number; source: ChangesSource }) {
  const t = useTranslations('team.dsh');
  const [summary, setSummary] = useState<TurnChanges | null>(null);
  const [all, setAll] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let live = true;
    // A computer that keeps no record, or a plugin too old to pass it on, leaves no card.
    source.load(seq).then((read) => { if (live) setSummary(read); }, () => {});
    return () => { live = false; };
  }, [source, seq]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!summary || summary.files.length === 0) return null;
  const rest = (index: number | null) => {
    clearTimeout(timer.current);
    if (index === null) return setHovered(null);
    timer.current = setTimeout(() => setHovered(index), HOVER_DELAY);
  };
  if (summary.files.length === 1) {
    const file = summary.files[0]!;
    return (
      <FileCard path={file.display} openFile={() => source.open(seq, turn, 0)}
        description={<>{t('edited')} · <LineCounts added={file.added} deleted={file.deleted} /></>} />
    );
  }
  const shown = all ? summary.files : summary.files.slice(0, FOLDED);
  return (
    <div className="relative flex min-w-0 flex-col rounded-xl border-[0.5px] border-border bg-muted">
      <button type="button" onClick={() => source.open(seq, turn, 0)}
        className="group/card flex h-[60px] items-center gap-2.5 rounded-t-xl px-2.5 text-start hover:bg-secondary">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-border bg-background/50">
          <FileTypeIcon kind="code" size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] leading-5 font-medium">{t('filesChanged', { count: summary.total })}</span>
          <span className="text-[10px] leading-4 text-muted-foreground">
            <span className="group-hover/card:hidden"><LineCounts added={summary.added} deleted={summary.deleted} /></span>
            <span className="hidden group-hover/card:inline">{t('previewInSidebar')}</span>
          </span>
        </span>
      </button>
      <ul className="flex flex-col border-t-[0.5px] border-border py-1">
        {shown.map((file, index) => (
          <li key={file.path} className="relative" onMouseEnter={() => rest(index)} onMouseLeave={() => rest(null)}>
            <button type="button" onClick={() => source.open(seq, turn, index)} title={file.display}
              className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-secondary">
              <FileTypeIcon path={file.display} size={14} />
              <span className="min-w-0 flex-1 truncate font-mono">{file.display}</span>
              {!file.binary && !file.oversized && <LineCounts added={file.added} deleted={file.deleted} />}
            </button>
            {hovered === index && <DiffPreview seq={seq} index={index} source={source} />}
          </li>
        ))}
      </ul>
      {summary.files.length > FOLDED && (
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
          className="flex items-center justify-center gap-1 rounded-b-xl border-t-[0.5px] border-border py-1.5 text-xs text-muted-foreground hover:bg-secondary">
          {all ? t('filesCollapse') : t('filesAll', { count: summary.files.length })}
        </button>
      )}
    </div>
  );
}

/** A changed file's comparison, floating under its row: 48px narrower than the card, 420px tall at most. */
function DiffPreview({ seq, index, source }: { seq: number; index: number; source: ChangesSource }) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  useEffect(() => {
    let live = true;
    source.diff(seq, index).then((read) => { if (live) setDiff(read); }, () => {});
    return () => { live = false; };
  }, [source, seq, index]);
  if (!diff) return null;
  return (
    <div className="absolute inset-x-6 top-full z-30 max-h-[420px] overflow-auto rounded-lg border-[0.5px] border-border bg-card shadow-lg">
      <DiffLines diff={diff} />
    </div>
  );
}

/**
 * DSH's comparison of one file as lines: each hunk under its header, added lines on a green ground and deleted ones on
 * a red one, with the old and new line numbers beside them.
 */
export function DiffLines({ diff }: { diff: FileDiff }) {
  const t = useTranslations('team.dsh');
  if (diff.kind !== 'text') return <p className="px-3 py-2 text-xs text-muted-foreground">{t(diff.kind === 'binary' ? 'diffBinary' : 'diffOversized')}</p>;
  if (diff.hunks.length === 0) return <p className="px-3 py-2 text-xs text-muted-foreground">{t('diffSame')}</p>;
  return (
    <div className="w-max min-w-full py-1 font-mono text-[11px] leading-[1.6]">
      {diff.hunks.map((hunk, h) => {
        let old = hunk.oldStart;
        let next = hunk.newStart;
        return (
          <div key={h}>
            <div className="bg-secondary/60 px-3 text-muted-foreground">@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</div>
            {hunk.lines.map((line, i) => {
              const mark = line[0];
              const left = mark === '+' ? '' : old++;
              const right = mark === '-' ? '' : next++;
              return (
                <div key={i} className={cn('flex', mark === '+' && 'bg-success/12', mark === '-' && 'bg-destructive/12')}>
                  <span aria-hidden className="w-10 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">{left}</span>
                  <span aria-hidden className="w-10 shrink-0 pr-2 text-right text-muted-foreground/60 select-none">{right}</span>
                  <span className="pr-3 whitespace-pre">{line}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {(diff.truncated || diff.coarse) && <p className="px-3 py-1 font-sans text-muted-foreground">{t(diff.truncated ? 'diffTruncated' : 'diffCoarse')}</p>}
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
