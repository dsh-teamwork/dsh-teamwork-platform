/**
 * How a session's items are laid out, on the phone and on the web. What a
 * person reads is the conversation; the agent's tool calls are how it got
 * there, so consecutive ones fold into one "steps" row that opens on a tap.
 * The question tool is not a step: its card asks the member directly.
 */

import type { ConversationItem, ToolStatus } from './types';

type Tool = Extract<ConversationItem, { kind: 'tool' }>;

export type Row =
  | Extract<ConversationItem, { kind: 'user' }>
  | { kind: 'assistant'; id: string; text: string }
  | Extract<ConversationItem, { kind: 'page' }>
  | Extract<ConversationItem, { kind: 'failed' }>
  | { kind: 'steps'; id: string; tools: Tool[]; status: ToolStatus };

/** Tools whose work the member answers on a card instead of reading about. */
const ASKING = new Set(['ask_user_question']);

export function rowsOf(items: readonly ConversationItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    if (item.kind !== 'tool') {
      rows.push(item);
      continue;
    }
    if (ASKING.has(item.name)) continue;
    const last = rows.at(-1);
    if (last?.kind === 'steps') {
      last.tools.push(item);
      last.status = groupStatus(last.tools);
    } else {
      rows.push({ kind: 'steps', id: `steps-${item.id}`, tools: [item], status: item.status });
    }
  }
  return rows;
}

/** A group is running while any step runs, failed if any failed or was denied, done otherwise. */
function groupStatus(tools: readonly Tool[]): ToolStatus {
  if (tools.some((t) => t.status === 'running')) return 'running';
  if (tools.some((t) => t.status === 'failed')) return 'failed';
  if (tools.some((t) => t.status === 'denied')) return 'denied';
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
