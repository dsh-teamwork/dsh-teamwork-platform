/**
 * Comments in the knowledge editor (docs/tech/knowledge.md, "Comments"): a
 * thread quotes words of a version, and the editor marks the first place in
 * the text it shows that holds those words, within one paragraph, heading or
 * cell. A thread whose words are no longer there is still listed beside the
 * text, as about words this version no longer holds. Comments are never in
 * the text: the marks are decorations, and saving writes none of them.
 */

import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** A thread the editor marks: its id and the words it quotes. */
export interface CommentMark {
  id: string;
  quote: string;
}

/** Where a quote first is in a document, within one textblock, as positions; text inside a link or a mention is not counted. */
export function findQuote(doc: ProseNode, quote: string): { from: number; to: number } | null {
  if (!quote) return null;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const positions: number[] = [];
    let text = '';
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      for (let i = 0; i < child.text.length; i++) positions.push(pos + 1 + offset + i);
      text += child.text;
    });
    const at = text.indexOf(quote);
    if (at >= 0) found = { from: positions[at], to: positions[at + quote.length - 1] + 1 };
    return false;
  });
  return found;
}

const key = new PluginKey<{ set: DecorationSet; placed: string[] }>('knowledgeComments');

/**
 * The plugin that marks each thread's quote, the active one apart, and
 * reports which threads it placed. `marks` is read whenever the document
 * changes or `refreshComments` is dispatched.
 */
export function commentsPlugin(marks: { current: { comments: CommentMark[]; active: string } }, placed: { current?: (ids: string[]) => void }) {
  const build = (doc: ProseNode) => {
    const decorations: Decoration[] = [];
    const ids: string[] = [];
    for (const c of marks.current.comments) {
      const range = findQuote(doc, c.quote);
      if (!range) continue;
      ids.push(c.id);
      decorations.push(Decoration.inline(range.from, range.to, { class: c.id === marks.current.active ? 'knowledge-comment-mark is-active' : 'knowledge-comment-mark', 'data-comment': c.id }));
    }
    return { set: DecorationSet.create(doc, decorations), placed: ids };
  };
  return $prose(() => new Plugin({
    key,
    state: {
      init: (_config, state) => build(state.doc),
      apply: (tr, old) => (tr.getMeta(key) || tr.docChanged ? build(tr.doc) : old),
    },
    props: { decorations: (state) => key.getState(state)?.set },
    view: (view) => {
      let reported = '';
      const report = () => {
        const ids = key.getState(view.state)?.placed ?? [];
        if (ids.join('\n') === reported) return;
        reported = ids.join('\n');
        placed.current?.(ids);
      };
      report();
      return { update: report };
    },
  }));
}

/** A transaction that marks the threads again, as `marks` now holds them. */
export function refreshComments(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(key, true));
}

/** Words selected in a read-only document, to open a thread on: within one block, with the heading above them. */
export interface Quote {
  quote: string;
  anchor: string;
  top: number;
  left: number;
}

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, .knowledge-callout-title';

/** The selection inside `root` as a quote, or null when there is none to comment on. */
export function selectedQuote(root: HTMLElement): Quote | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => (node instanceof Element ? node : node.parentElement);
  const start = element(range.startContainer)?.closest(BLOCKS);
  const end = element(range.endContainer)?.closest(BLOCKS);
  if (!start || start !== end || !root.contains(start)) return null;
  const quote = selection.toString().replace(/\s+/g, ' ').trim();
  if (!quote || quote.length > 500) return null;
  // The heading above: the nearest one before the top-level block holding the words.
  const document = root.querySelector('.ProseMirror');
  let top: Element | null = start;
  while (top && top.parentElement !== document) top = top.parentElement;
  let anchor = '';
  for (let at = top; at; at = at.previousElementSibling) {
    if (/^H[1-6]$/.test(at.tagName) && at.id) {
      anchor = at.id;
      break;
    }
  }
  const rect = range.getBoundingClientRect();
  return { quote, anchor, top: rect.bottom, left: rect.left + rect.width / 2 };
}
