/**
 * The richer format's blocks and mentions in the knowledge editor
 * (docs/tech/knowledge.md, "Format"), each still plain text in the file:
 *
 * - **Callouts**, Obsidian's `> [!kind] Title` quotes, `-` or `+` after the
 *   kind to fold one. A remark plugin reads such a quote into a `callout`
 *   node (its title, then its blocks), and a stringify handler writes it back
 *   as the same quote. Typing `[!kind] ` at the start of a quote makes one.
 *   Folding is the reader's: the file's `-` only says how it opens.
 * - **Diagrams**, a `mermaid` code block, drawn under its source while
 *   editing and in its place while reading. Mermaid loads the first time a
 *   diagram is drawn, never with the editor.
 * - **Mentions**, `@[Name](member-id)`, shown as the team names the member
 *   now; typing `@` lists the members (components/knowledge-slash.tsx).
 *
 * Each draws through a node view that reads its words and whether the editor
 * is editable as it draws, so a reader's view and an editor's share one
 * schema.
 */

import type { Ctx } from '@milkdown/kit/ctx';
import { codeBlockSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $inputRule, $node, $remark, $view } from '@milkdown/kit/utils';

import { CALLOUT, CALLOUT_KINDS, calloutFamily, DIAGRAM_LANGUAGE, type CalloutFold } from '@dsh-teamwork/shared/knowledge-format';

/** What the blocks say to a person: names of kinds and folds, and a diagram that cannot be drawn. */
export interface BlockWords {
  kind: (kind: string) => string;
  kindLabel: string;
  fold: Record<'none' | 'open' | 'closed', string>;
  foldLabel: string;
  toggle: string;
  diagramError: string;
}

interface MdNode {
  type: string;
  value?: string;
  kind?: string;
  fold?: string;
  id?: string;
  name?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
}

/** The quote as a callout when its first line is `[!kind]`, else null. */
function toCallout(quote: MdNode): MdNode | null {
  const first = quote.children?.[0];
  const head = first?.type === 'paragraph' ? first.children?.[0] : undefined;
  if (!first || head?.type !== 'text' || head.value === undefined) return null;
  const match = CALLOUT.exec(head.value);
  if (!match) return null;
  // The title runs to the end of the first line; the rest of that paragraph is the body's first.
  const rest: MdNode[] = [{ type: 'text', value: head.value.slice(match[0].length) }, ...(first.children ?? []).slice(1)];
  const title: MdNode[] = [];
  let body: MdNode[] = [];
  for (let i = 0; i < rest.length; i++) {
    const node = rest[i];
    if (node.type === 'text' && node.value?.includes('\n')) {
      const at = node.value.indexOf('\n');
      title.push({ type: 'text', value: node.value.slice(0, at) });
      const after = node.value.slice(at + 1);
      body = [...(after ? [{ type: 'text', value: after }] : []), ...rest.slice(i + 1)];
      break;
    }
    if (node.type === 'break') {
      body = rest.slice(i + 1);
      break;
    }
    title.push(node);
  }
  const titled = title.filter((n) => !(n.type === 'text' && !n.value));
  const last = titled.at(-1);
  if (last?.type === 'text' && last.value) last.value = last.value.trimEnd();
  return {
    type: 'callout',
    kind: match[1],
    fold: match[2],
    children: [
      { type: 'calloutTitle', children: titled.filter((n) => !(n.type === 'text' && !n.value)) },
      ...(body.length ? [{ type: 'paragraph', children: body }] : []),
      ...(quote.children ?? []).slice(1),
    ],
  };
}

function readCallouts(node: MdNode) {
  if (!node.children) return;
  for (const child of node.children) readCallouts(child);
  node.children = node.children.map((child) => (child.type === 'blockquote' ? (toCallout(child) ?? child) : child));
}

export const remarkCallout = $remark('remarkCallout', () => () => (tree: unknown) => readCallouts(tree as MdNode));

/** The parts of remark-stringify's state a callout is written with. */
interface StringifyState {
  enter: (construct: string) => () => void;
  createTracker: (info: unknown) => { move: (value: string) => void; shift: (n: number) => void; current: () => Record<string, unknown> };
  containerPhrasing: (node: MdNode, info: Record<string, unknown>) => string;
  containerFlow: (node: MdNode, info: Record<string, unknown>) => string;
  indentLines: (value: string, map: (line: string, index: number, blank: boolean) => string) => string;
}

/**
 * Writes a callout back as its quote: `[!kind]` and the fold, the title, then
 * its blocks, a paragraph straight under the title line as Obsidian writes
 * one and any other block after a blank line, so each reads back the same.
 */
export function stringifyCallout(node: MdNode, _parent: unknown, state: StringifyState, info: unknown): string {
  const exit = state.enter('blockquote');
  const tracker = state.createTracker(info);
  tracker.move('> ');
  tracker.shift(2);
  const [title, ...body] = node.children ?? [];
  const head = `[!${node.kind ?? 'note'}]${node.fold ?? ''}`;
  const titled = title?.children?.length ? state.containerPhrasing(title, { ...tracker.current(), before: ' ', after: '\n' }) : '';
  const flow = body.length ? state.containerFlow({ type: 'blockquote', children: body }, tracker.current()) : '';
  exit();
  const first = head + (titled ? ` ${titled}` : '');
  const value = flow ? `${first}\n${body[0].type === 'paragraph' ? '' : '\n'}${flow}` : first;
  return state.indentLines(value, (line, _i, blank) => `>${blank ? '' : ' '}${line}`);
}

export const calloutTitleNode = $node('calloutTitle', () => ({
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'div.knowledge-callout-title' }],
  toDOM: () => ['div', { class: 'knowledge-callout-title' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'calloutTitle',
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.children) state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'calloutTitle',
    runner: (state, node) => {
      state.openNode('calloutTitle');
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export const calloutNode = $node('callout', () => ({
  group: 'block',
  content: 'calloutTitle block*',
  defining: true,
  attrs: { kind: { default: 'note' }, fold: { default: '' } },
  parseDOM: [{
    tag: 'div[data-callout]',
    contentElement: '.knowledge-callout-body',
    getAttrs: (dom) => ({ kind: (dom as HTMLElement).dataset.callout ?? 'note', fold: (dom as HTMLElement).dataset.fold ?? '' }),
  }],
  toDOM: (node) => ['div', { class: 'knowledge-callout', 'data-callout': node.attrs.kind, 'data-fold': node.attrs.fold, 'data-family': calloutFamily(String(node.attrs.kind)) }, ['div', { class: 'knowledge-callout-body' }, 0]],
  parseMarkdown: {
    match: (node) => node.type === 'callout',
    runner: (state, node, type) => {
      const md = node as unknown as MdNode;
      state.openNode(type, { kind: md.kind ?? 'note', fold: md.fold ?? '' });
      if (node.children) state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'callout',
    runner: (state, node) => {
      state.openNode('callout', undefined, { kind: node.attrs.kind, fold: node.attrs.fold });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

function option(value: string, label: string, selected: boolean) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
}

/**
 * A callout drawn with its controls: while reading, a toggle on one that
 * folds; while editing, its kind and how it folds, each a choice. A folded
 * one shows its title alone; one with no title shows its kind's name.
 */
export function calloutView(words: { current: BlockWords }) {
  return $view(calloutNode, () => (initial, view, getPos) => {
    let node = initial;
    const dom = document.createElement('div');
    dom.className = 'knowledge-callout';
    const label = document.createElement('div');
    label.className = 'knowledge-callout-label';
    label.setAttribute('contenteditable', 'false');
    const controls = document.createElement('div');
    controls.className = 'knowledge-callout-controls';
    controls.setAttribute('contenteditable', 'false');
    const body = document.createElement('div');
    body.className = 'knowledge-callout-body';
    dom.append(label, controls, body);
    let folded = node.attrs.fold === '-';

    const change = (attrs: Record<string, unknown>) => {
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
    };
    const paint = () => {
      const kind = String(node.attrs.kind);
      const fold = String(node.attrs.fold) as CalloutFold;
      dom.dataset.callout = kind;
      dom.dataset.family = calloutFamily(kind);
      dom.dataset.fold = fold;
      dom.classList.toggle('is-folded', folded && fold !== '');
      dom.classList.toggle('is-untitled', node.firstChild?.content.size === 0);
      label.textContent = words.current.kind(kind);
      controls.replaceChildren();
      if (view.editable) {
        const kinds = document.createElement('select');
        kinds.ariaLabel = words.current.kindLabel;
        const known = (CALLOUT_KINDS as readonly string[]).includes(kind.toLowerCase());
        for (const k of known ? CALLOUT_KINDS : [kind, ...CALLOUT_KINDS]) kinds.append(option(k, words.current.kind(k), k === kind.toLowerCase() || k === kind));
        kinds.onchange = () => change({ kind: kinds.value });
        const folds = document.createElement('select');
        folds.ariaLabel = words.current.foldLabel;
        folds.append(option('', words.current.fold.none, fold === ''), option('+', words.current.fold.open, fold === '+'), option('-', words.current.fold.closed, fold === '-'));
        folds.onchange = () => {
          folded = folds.value === '-';
          change({ fold: folds.value });
        };
        controls.append(kinds, folds);
      } else if (fold !== '') {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'knowledge-callout-toggle';
        toggle.ariaLabel = words.current.toggle;
        toggle.ariaExpanded = String(!folded);
        toggle.onclick = () => {
          folded = !folded;
          paint();
        };
        controls.append(toggle);
      }
    };
    paint();
    return {
      dom,
      contentDOM: body,
      update: (next) => {
        if (next.type !== node.type) return false;
        node = next;
        paint();
        return true;
      },
      stopEvent: (event) => label.contains(event.target as Node) || controls.contains(event.target as Node),
      ignoreMutation: (mutation) => label.contains(mutation.target) || controls.contains(mutation.target),
    };
  });
}

/** Typing `[!kind] ` at the very start of a quote turns the quote into a callout, its title next. */
export const calloutInputRule = $inputRule((ctx) => new InputRule(/^\[!([A-Za-z][\w-]*)\]([+-]?)\s$/, (state, match, start, end) => {
  const $start = state.doc.resolve(start);
  if ($start.parent.type.name !== 'paragraph' || $start.parentOffset !== 0 || $start.depth < 2) return null;
  const quote = $start.node(-1);
  if (quote.type.name !== 'blockquote' || $start.index(-1) !== 0) return null;
  const rest = $start.parent.content.cut(end - $start.start());
  const body: ProseNode[] = [];
  if (rest.size > 0) body.push(paragraphSchema.type(ctx).create(null, rest));
  quote.forEach((child, _offset, i) => {
    if (i > 0) body.push(child);
  });
  const callout = calloutNode.type(ctx).create({ kind: match[1], fold: match[2] }, [calloutTitleNode.type(ctx).create(), ...body]);
  const from = $start.before(-1);
  const tr = state.tr.replaceWith(from, $start.after(-1), callout);
  return tr.setSelection(TextSelection.create(tr.doc, from + 2));
}));

/** An empty callout of a kind in place of the empty paragraph the cursor is in, its title ready to type; Enter in the title starts its body. */
export function insertCallout(view: EditorView, ctx: Ctx, kind = 'note') {
  const { $from } = view.state.selection;
  const callout = calloutNode.type(ctx).create({ kind, fold: '' }, [calloutTitleNode.type(ctx).create()]);
  const from = $from.before();
  const tr = view.state.tr.replaceWith(from, $from.after(), callout);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2)).scrollIntoView());
}

let mermaid: Promise<{ render: (id: string, text: string) => Promise<{ svg: string }> }> | null = null;
let drawn = 0;

/** A diagram's SVG, drawn by Mermaid at its strict level, which runs none of a source's script and sanitises its text. */
async function drawDiagram(source: string): Promise<string> {
  mermaid ??= import('mermaid').then(({ default: m }) => {
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.classList.contains('dark') ? 'dark' : 'neutral', fontFamily: 'inherit' });
    return m;
  });
  const m = await mermaid;
  const { svg } = await m.render(`knowledge-diagram-${++drawn}`, source);
  return svg;
}

/**
 * Every code block, drawn as commonmark draws one, and a `mermaid` one with
 * its diagram: under the source while editing, redrawn a moment after the
 * source changes, and in place of it while reading.
 */
export function codeBlockView(words: { current: BlockWords }) {
  return $view(codeBlockSchema.node, () => (initial, view) => {
    let node = initial;
    const language = String(node.attrs.language);
    const pre = document.createElement('pre');
    if (language) pre.dataset.language = language;
    const code = document.createElement('code');
    pre.append(code);
    const same = (next: ProseNode) => next.type === node.type && String(next.attrs.language) === language;
    if (language !== DIAGRAM_LANGUAGE) {
      return {
        dom: pre,
        contentDOM: code,
        update: (next) => {
          if (!same(next)) return false;
          node = next;
          return true;
        },
      };
    }
    const dom = document.createElement('div');
    dom.className = 'knowledge-diagram';
    const preview = document.createElement('div');
    preview.className = 'knowledge-diagram-preview';
    preview.setAttribute('contenteditable', 'false');
    dom.append(pre, preview);
    dom.classList.toggle('is-reading', !view.editable);
    let source = node.textContent;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let turn = 0;
    const draw = () => {
      const mine = ++turn;
      drawDiagram(source).then(
        (svg) => {
          if (mine !== turn) return;
          preview.innerHTML = svg;
          preview.classList.remove('is-error');
        },
        () => {
          if (mine !== turn) return;
          preview.textContent = words.current.diagramError;
          preview.classList.add('is-error');
        },
      );
    };
    if (source.trim()) draw();
    return {
      dom,
      contentDOM: code,
      update: (next) => {
        if (!same(next)) return false;
        node = next;
        if (next.textContent !== source) {
          source = next.textContent;
          clearTimeout(timer);
          timer = setTimeout(draw, 400);
        }
        return true;
      },
      ignoreMutation: (mutation) => preview.contains(mutation.target),
      destroy: () => clearTimeout(timer),
    };
  });
}

/**
 * A mention of a member, `@[Name](member-id)` (docs/tech/knowledge.md,
 * "Format"). Remark reads it as `@` followed by a link whose address is the
 * id; this plugin joins the two into a `mention`, and the stringify handler
 * writes it back as written. The name is the one it was written with, kept
 * so the file reads without the console; the console shows the member as the
 * team names them now.
 */
const MEMBER_ID = /^[\w-]{4,64}$/;

/** A node's text, every child's joined. */
function plain(node: MdNode): string {
  return node.value ?? (node.children ?? []).map(plain).join('');
}

function readMentions(node: MdNode) {
  if (!node.children) return;
  const out: MdNode[] = [];
  for (const child of node.children) {
    const before = out.at(-1);
    if (child.type === 'link' && MEMBER_ID.test(child.url ?? '') && !child.title && before?.type === 'text' && before.value?.endsWith('@')) {
      // The name as written, an email that gfm made a link of included.
      const name = plain(child);
      before.value = before.value.slice(0, -1);
      if (!before.value) out.pop();
      out.push({ type: 'mention', id: child.url, name });
      continue;
    }
    readMentions(child);
    out.push(child);
  }
  node.children = out;
}

export const remarkMention = $remark('remarkMention', () => () => (tree: unknown) => readMentions(tree as MdNode));

/** Writes a mention back as `@[Name](id)`. */
export function stringifyMention(node: MdNode): string {
  return `@[${(node.name ?? '').replace(/[[\]\n]/g, '')}](${node.id ?? ''})`;
}

export const mentionNode = $node('mention', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: { id: { default: '' }, name: { default: '' } },
  parseDOM: [{ tag: 'span[data-mention]', getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.mention ?? '', name: (dom as HTMLElement).dataset.name ?? '' }) }],
  toDOM: (node) => ['span', { class: 'knowledge-mention', 'data-mention': node.attrs.id, 'data-name': node.attrs.name }, `@${String(node.attrs.name)}`],
  parseMarkdown: {
    match: (node) => node.type === 'mention',
    runner: (state, node, type) => {
      const md = node as unknown as MdNode;
      state.addNode(type, { id: md.id ?? '', name: md.name ?? '' });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'mention',
    runner: (state, node) => {
      state.addNode('mention', undefined, undefined, { id: node.attrs.id, name: node.attrs.name });
    },
  },
}));

/** Who a mention is to the reader: the team's name for them now, or null for someone no longer in it; and whether it is the reader. */
export type MemberResolver = (id: string) => { name: string; me: boolean } | null;

/** Mentions drawn as the team names each member now, the reader's own marked. */
export function mentionView(members: { current: MemberResolver }) {
  return $view(mentionNode, () => (node) => {
    const dom = document.createElement('span');
    dom.className = 'knowledge-mention';
    dom.dataset.mention = String(node.attrs.id);
    const who = members.current(String(node.attrs.id));
    dom.textContent = `@${who?.name ?? String(node.attrs.name)}`;
    dom.classList.toggle('is-me', who?.me === true);
    dom.classList.toggle('is-gone', who === null);
    return { dom, ignoreMutation: () => true };
  });
}
