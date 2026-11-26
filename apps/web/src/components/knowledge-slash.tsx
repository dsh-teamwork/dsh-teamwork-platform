/**
 * The knowledge editor's menus (docs/tech/knowledge.md, "Format"): typing
 * `/` at the start of an empty line lists the blocks a document can hold,
 * narrowed as more is typed, by the English word or the reader's; typing `@`
 * after a space lists the team's members to mention. Arrow keys move, Enter
 * or Tab inserts, Escape leaves what was typed. The choice replaces the `/`
 * or `@` and what follows it.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  createCodeBlockCommand,
  insertHrCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { insertTableCommand } from '@milkdown/kit/preset/gfm';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { useEffect, useRef } from 'react';

import { DIAGRAM_LANGUAGE } from '@/lib/knowledge-format';
import { cn } from '@/lib/utils';

import { insertCallout, mentionNode } from './knowledge-blocks';

/** Where a menu is open: the `/` or `@` and what follows it, and where to draw it. */
export interface SlashOpen {
  kind: 'block' | 'mention';
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
}

/** A diagram's source when it is first inserted, so it draws at once. */
const DIAGRAM_START = 'flowchart LR\n  A[Start] --> B[Done]';

const ITEMS = [
  { id: 'heading1', words: 'heading h1 title' },
  { id: 'heading2', words: 'heading h2 subtitle' },
  { id: 'heading3', words: 'heading h3' },
  { id: 'bulletList', words: 'bullet list unordered ul' },
  { id: 'orderedList', words: 'numbered ordered list ol' },
  { id: 'taskList', words: 'task todo checkbox list' },
  { id: 'quote', words: 'quote blockquote' },
  { id: 'callout', words: 'callout note warning tip admonition' },
  { id: 'codeBlock', words: 'code block snippet' },
  { id: 'diagram', words: 'diagram mermaid chart flowchart' },
  { id: 'table', words: 'table grid' },
  { id: 'divider', words: 'divider rule hr line' },
  { id: 'attach', words: 'image file attachment upload picture' },
  { id: 'artifact', words: 'artifact embed report page dashboard' },
] as const;

export type SlashItemId = (typeof ITEMS)[number]['id'];

/** The menu's state as the editor's plugin finds it on every change, or null when closed. */
export function findSlash(view: EditorView): SlashOpen | null {
  const { selection } = view.state;
  if (!view.editable || !selection.empty) return null;
  const { $from } = selection;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const before = parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const block = parent.type.name === 'paragraph' ? /^\/([^\s/]{0,24})$/.exec(before) : null;
  if (block) {
    const coords = view.coordsAtPos($from.start());
    return { kind: 'block', from: $from.start(), to: selection.from, query: block[1], left: coords.left, top: coords.bottom };
  }
  const mention = /(?:^|[\s(])@([^\s[\]()@]*(?: +[^\s[\]()@]+|@[^\s[\]()@]+)* *)$/.exec(before);
  if (!mention || mention[1].length > 80) return null;
  const from = selection.from - mention[1].length - 1;
  const coords = view.coordsAtPos(from);
  return { kind: 'mention', from, to: selection.from, query: mention[1], left: coords.left, top: coords.bottom };
}

/** A member as a mention names them. */
export interface Mentionable {
  id: string;
  name: string;
  detail?: string;
}

/** Puts a mention of a member where the `@` and its query were, and a space after it. */
export function insertMention(ctx: Ctx, open: SlashOpen, member: Mentionable) {
  const view = ctx.get(editorViewCtx);
  const node = mentionNode.type(ctx).create({ id: member.id, name: member.name.replace(/[[\]\n]/g, '') });
  const tr = view.state.tr.replaceWith(open.from, open.to, node);
  view.dispatch(tr.insertText(' ').scrollIntoView());
  view.focus();
}

/** The members a query keeps, by name, at most eight. */
export function mentionItems(query: string, members: Mentionable[]): Mentionable[] {
  const q = query.trim().replace(/ +/g, ' ').toLocaleLowerCase();
  return members.filter((m) => m.name.toLocaleLowerCase().includes(q) || m.detail?.toLocaleLowerCase().includes(q)).slice(0, 8);
}

/** The plugin that reports the menu's state and gives its keys to `keys` first. */
export function slashPlugin(report: (open: SlashOpen | null) => void, keys: { current: (event: KeyboardEvent) => boolean }) {
  return $prose(() => new Plugin({
    view: (view) => {
      report(findSlash(view));
      return { update: (next) => report(findSlash(next)), destroy: () => report(null) };
    },
    props: { handleKeyDown: (_view, event) => keys.current(event) },
  }));
}

/** Runs an item where the menu was open, the `/` and its query first removed. */
export function runSlash(ctx: Ctx, open: SlashOpen, id: SlashItemId, attach?: () => void, artifact?: () => void) {
  const view = ctx.get(editorViewCtx);
  const commands = ctx.get(commandsCtx);
  view.dispatch(view.state.tr.delete(open.from, open.to));
  switch (id) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
      commands.call(wrapInHeadingCommand.key, Number(id.slice(-1)));
      break;
    case 'bulletList':
      commands.call(wrapInBulletListCommand.key);
      break;
    case 'orderedList':
      commands.call(wrapInOrderedListCommand.key);
      break;
    case 'taskList': {
      commands.call(wrapInBulletListCommand.key);
      const { $from } = view.state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'list_item') {
          view.dispatch(view.state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: false }));
          break;
        }
      }
      break;
    }
    case 'quote':
      commands.call(wrapInBlockquoteCommand.key);
      break;
    case 'callout':
      insertCallout(view, ctx);
      break;
    case 'codeBlock':
      commands.call(createCodeBlockCommand.key);
      break;
    case 'diagram':
      commands.call(createCodeBlockCommand.key, DIAGRAM_LANGUAGE);
      view.dispatch(view.state.tr.insertText(DIAGRAM_START));
      break;
    case 'table':
      commands.call(insertTableCommand.key, { row: 3, col: 3 });
      break;
    case 'divider':
      commands.call(insertHrCommand.key);
      break;
    case 'attach':
      attach?.();
      break;
    case 'artifact':
      artifact?.();
      break;
  }
  view.focus();
}

/** The items a query keeps, by either language, in their order; files and artifacts only where the page can choose one. */
export function slashItems(query: string, name: (id: SlashItemId) => string, can: { attach: boolean; artifact: boolean }): SlashItemId[] {
  const q = query.toLocaleLowerCase();
  return ITEMS.filter((item) => (item.id !== 'attach' || can.attach) && (item.id !== 'artifact' || can.artifact) && (!q || `${item.words} ${name(item.id)}`.toLocaleLowerCase().includes(q))).map((item) => item.id);
}

/** A menu, drawn where the `/` or `@` is. */
export function SlashMenu({ label, empty, items, active, top, left, onPick, onHover }: {
  label: string;
  empty: string;
  items: { key: string; label: string; detail?: string }[];
  active: number;
  top: number;
  left: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      style={{ top: Math.min(top + 4, window.innerHeight - Math.min(items.length * 54 + 10, 288) - 8), left: Math.max(8, Math.min(left, window.innerWidth - 288)) }}
      className="fixed z-50 flex max-h-72 w-70 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-lg border bg-card p-1 text-sm text-card-foreground shadow-lg"
      // The editor keeps the focus, so typing still narrows the list.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-muted-foreground">{empty}</p>
      ) : (
        items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(i)}
            className={cn('rounded-md px-2 py-1.5 text-start [overflow-wrap:anywhere]', i === active && 'bg-accent text-accent-foreground')}
          >
            <span className="block">{item.label}</span>
            {item.detail && <span className="block text-xs opacity-80">{item.detail}</span>}
          </button>
        ))
      )}
    </div>
  );
}
