/**
 * How a session's items are laid out, on the phone and on the web. What a
 * person reads is the conversation; the agent's tool calls are how it got
 * there, so consecutive ones fold into one "steps" row that opens on a tap.
 * The question tool is not a step: its card asks the member directly.
 */

import type { ConversationItem, ToolStatus } from './types';

export type Tool = Extract<ConversationItem, { kind: 'tool' }>;
type Deliverable = Extract<ConversationItem, { kind: 'deliverable' }>;
type Reasoning = { kind: 'reasoning'; id: string; text: string; turn?: number; status: ToolStatus };
type ProcessEntry = Tool | Reasoning;

export type Row =
  | Extract<ConversationItem, { kind: 'user' }>
  | Omit<Extract<ConversationItem, { kind: 'assistant' }>, 'reasoning' | 'turn'>
  | Extract<ConversationItem, { kind: 'artifact' }>
  | Deliverable
  | Extract<ConversationItem, { kind: 'failed' }>
  | { kind: 'work'; id: string; count: number }
  | { kind: 'steps'; id: string; entries: ProcessEntry[]; count: number; status: ToolStatus; workId?: string };

/** Tools whose work the member answers on a card instead of reading about. */
const ASKING = new Set(['ask_user_question']);

/** DSH removes provider signatures before presenting reasoning, including partial streamed tags. */
export function visibleReasoning(text: string): string {
  const unsigned = text.replace(/<signature>[\s\S]*?(?:<\/signature>(?:\r?\n)*|$)/g, '');
  const tag = unsigned.lastIndexOf('<');
  return tag >= 0 && '<signature>'.startsWith(unsigned.slice(tag)) ? unsigned.slice(0, tag) : unsigned;
}

export function rowsOf(items: readonly ConversationItem[]): Row[] {
  const rows: Row[] = [];
  const ended = new Set(items.flatMap((item) => item.kind === 'turn-end' ? [item.turn] : []));
  const turns = new Map<number, { first: string; count: number; inputs: number }>();
  const folded = new Map<number, Row & { kind: 'work' }>();
  const deliveries = new Map<number, Deliverable[]>();
  let inputs = 0;

  function addProcess(entry: ProcessEntry) {
    const last = rows.at(-1);
    const group = last?.kind === 'steps' && last.entries[0]?.turn === entry.turn ? last
      : { kind: 'steps' as const, id: `steps-${entry.id}`, entries: [], count: 0, status: entry.status };
    if (group !== last) rows.push(group);
    group.entries.push(entry);
    const count = entry.kind === 'tool' ? 1 : 0;
    group.count += count;
    if (entry.turn !== undefined) {
      const turn = turns.get(entry.turn);
      if (turn) turn.count += count;
      else turns.set(entry.turn, { first: group.id, count, inputs });
    }
  }

  for (const item of items) {
    switch (item.kind) {
      case 'turn-end': {
        const turn = turns.get(item.turn);
        if (item.completed && turn && turn.inputs === inputs) {
          folded.set(item.turn, { kind: 'work', id: `work-${item.turn}`, count: turn.count });
        }
        rows.push(...(deliveries.get(item.turn) ?? []));
        deliveries.delete(item.turn);
        break;
      }
      case 'deliverable': {
        const files = deliveries.get(item.turn);
        if (files) files.push(item);
        else deliveries.set(item.turn, [item]);
        break;
      }
      case 'assistant': {
        const reasoning = item.reasoning ? visibleReasoning(item.reasoning) : '';
        if (reasoning.trim()) {
          addProcess({
            kind: 'reasoning', id: `reasoning-${item.id}`, text: reasoning, turn: item.turn,
            status: item.streaming && !ended.has(item.turn ?? 0) ? 'running' : 'done',
          });
        }
        if (item.text.trim()) {
          rows.push({
            kind: 'assistant', id: item.id, text: item.text,
            ...(item.streaming ? { streaming: true } : {}),
            ...(item.interrupted ? { interrupted: true } : {}),
          });
        }
        break;
      }
      case 'tool': {
        if (ASKING.has(item.name)) break;
        const stopped = item.status === 'running' && item.turn !== undefined && ended.has(item.turn);
        addProcess(stopped ? { ...item, status: 'stopped' } : item);
        break;
      }
      case 'tool-result':
        break;
      default:
        if (item.kind === 'user') inputs++;
        rows.push(item);
    }
  }
  for (const files of deliveries.values()) rows.push(...files);

  return rows.flatMap((row): Row[] => {
    if (row.kind !== 'steps') return [row];
    row.status = groupStatus(row.entries);
    const turn = row.entries[0]?.turn;
    if (turn === undefined) return [row];
    const work = folded.get(turn);
    if (!work) return [row];
    return turns.get(turn)?.first === row.id ? [work, { ...row, workId: work.id }] : [{ ...row, workId: work.id }];
  });
}

/** Keep reply and input order while hiding the process groups of closed disclosures. */
export function visibleConversationRows(rows: readonly Row[], isWorkOpen: (id: string) => boolean): Row[] {
  return rows.filter((row) => row.kind !== 'steps' || !row.workId || isWorkOpen(row.workId));
}

function groupStatus(entries: readonly ProcessEntry[]): ToolStatus {
  for (const status of ['running', 'failed', 'denied', 'stopped'] as const) {
    if (entries.some((entry) => entry.status === status)) return status;
  }
  return 'done';
}

/**
 * Whether the screen should say the agent is thinking: it is running, and the
 * last thing on screen is not a reply being written or a step being run.
 */
export function isThinking(rows: readonly Row[], running: boolean): boolean {
  if (!running) return false;
  const last = rows.at(-1);
  return !last || last.kind === 'user' || (last.kind === 'steps' && last.status !== 'running');
}

/**
 * The files a session wrote or edited, as its tool calls name them, the latest change first and each once: what a
 * screen lists as the session's changes. A failed or refused call changed nothing and is left out.
 */
export function touchedFiles(items: readonly ConversationItem[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== 'tool' || (item.status !== 'done' && item.status !== 'running')) continue;
    const key = toolKey(item.name);
    const path = item.file?.path ?? item.summary;
    if ((key === 'tools.write' || key === 'tools.edit') && path && !seen.has(path)) {
      seen.add(path);
      files.push(path);
    }
  }
  return files;
}

/**
 * A file a reply or a step names, when a text reads as one: a path with a folder (`src/app.ts`, `/home/me/x`) or a
 * file name with an extension (`README.md`), optionally `file://`, and optionally ending in `:line`, `:line:column` or `#Lline`,
 * which opens the file at that line. A web address, a package name (`@scope/name`), a command line, a version number
 * and unencoded whitespace or punctuation a path rarely holds are not files. The computer decides whether it exists.
 */
export function fileReference(text: string): { path: string; line?: number } | null {
  let value = text.trim();
  if (!value || value.length > 300 || /\s/.test(value)) return null;
  if (value.startsWith('file://')) value = value.slice('file://'.length);
  else if (value.startsWith('//') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(mailto|tel|data|javascript):/i.test(value)) return null;

  const fragment = /#L(\d+)(?:-L(\d+))?$/i.exec(value);
  const suffix = fragment ?? /:(\d+)(?::\d+|-([0-9]+))?$/.exec(value);
  let path: string;
  try { path = decodeURIComponent(suffix ? value.slice(0, suffix.index) : value); }
  catch { return null; }
  if (/^[@\-$#~]/.test(path) || /[\u0000-\u001f\u007f()<>{}'"`,;=|*?!&^%[\]]/.test(path)) return null;
  const line = Number(suffix?.[1]);
  const end = Number(suffix?.[2] ?? line);
  // A Windows drive letter is a path's start, not a line number.
  if (!path || /:/.test(path.replace(/^[A-Za-z]:(?=[\\/])/, ''))) return null;
  const name = path.split(/[\\/]/).pop() ?? '';
  const folder = /[\\/]/.test(path) && name !== '' && !path.endsWith('/');
  const named = /^[^.].*\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(name) || /^\.[A-Za-z]/.test(name);
  if (!folder && !named) return null;
  return Number.isSafeInteger(line) && Number.isSafeInteger(end) && line > 0 && end >= line ? { path, line } : { path };
}

export function documentPreviewKind(path: string): 'pdf' | 'workbook' | null {
  if (/\.xlsx?$/i.test(path)) return 'workbook';
  return /\.(pdf|docx?|pptx?)$/i.test(path) ? 'pdf' : null;
}

/** The locale key for a tool's friendly name, when one exists; otherwise the screen shows the tool's own name. */
export function toolKey(name: string): string | null {
  const known: Record<string, string> = {
    bash: 'command',
    shell: 'command',
    pwsh: 'command',
    read: 'read',
    read_file: 'read',
    write: 'write',
    write_file: 'write',
    edit: 'edit',
    str_replace_editor: 'edit',
    glob: 'search',
    grep: 'search',
    web_search: 'web',
    web_fetch: 'web',
    todo_write: 'plan',
  };
  return known[name] ? `tools.${known[name]}` : null;
}
