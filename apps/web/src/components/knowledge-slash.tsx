/**
 * The knowledge editor's slash menu (docs/tech/knowledge.md, "Format"):
 * typing `/` at the start of an empty line lists the blocks a document can
 * hold, narrowed as more is typed, by the English word or the reader's.
 * Arrow keys move, Enter or Tab inserts, Escape leaves the `/` as typed. The
 * chosen block replaces the `/` and what follows it.
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
import { useTranslations } from 'use-intl';

import { DIAGRAM_LANGUAGE } from '@/lib/knowledge-format';
import { cn } from '@/lib/utils';

import { insertCallout } from './knowledge-blocks';

/** Where the menu is open: the `/` and what follows it, and where to draw it. */
export interface SlashOpen {
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
] as const;

export type SlashItemId = (typeof ITEMS)[number]['id'];

/** The menu's state as the editor's plugin finds it on every change, or null when closed. */
export function findSlash(view: EditorView): SlashOpen | null {
  const { selection } = view.state;
  if (!view.editable || !selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph') return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = /^\/([^\s/]{0,24})$/.exec(before);
  if (!match) return null;
  const coords = view.coordsAtPos($from.start());
  return { from: $from.start(), to: selection.from, query: match[1], left: coords.left, top: coords.bottom };
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
export function runSlash(ctx: Ctx, open: SlashOpen, id: SlashItemId, attach?: () => void) {
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
  }
  view.focus();
}

/** The items a query keeps, by either language, in their order. */
export function slashItems(query: string, name: (id: SlashItemId) => string, canAttach: boolean): SlashItemId[] {
  const q = query.toLocaleLowerCase();
  return ITEMS.filter((item) => (item.id !== 'attach' || canAttach) && (!q || `${item.words} ${name(item.id)}`.toLocaleLowerCase().includes(q))).map((item) => item.id);
}

/** The menu, drawn where the `/` is. */
export function SlashMenu({ items, active, top, left, onPick, onHover }: {
  items: SlashItemId[];
  active: number;
  top: number;
  left: number;
  onPick: (id: SlashItemId) => void;
  onHover: (index: number) => void;
}) {
  const t = useTranslations('team.knowledge.editor.slash');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={t('label')}
      style={{ top: top + 4, left }}
      className="fixed z-50 flex max-h-72 w-56 flex-col overflow-y-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md"
      // The editor keeps the focus, so typing still narrows the list.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-muted-foreground">{t('empty')}</p>
      ) : (
        items.map((id, i) => (
          <button
            key={id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(id)}
            className={cn('rounded-md px-2 py-1.5 text-start', i === active && 'bg-accent text-accent-foreground')}
          >
            {t(id)}
          </button>
        ))
      )}
    </div>
  );
}
