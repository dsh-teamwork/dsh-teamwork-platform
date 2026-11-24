/**
 * The knowledge editor (docs/tech/knowledge.md, "Format" and "Rendering"):
 * Milkdown with its commonmark and gfm presets, which keeps Markdown as its
 * model, read-only to show a document and editable to change it. It reads and
 * writes Markdown and nothing else: front matter is split off before it opens
 * a document (lib/knowledge-format.ts), and `[[links]]` are an inline node of
 * their own, parsed by a remark plugin and written back exactly as typed.
 * Lists are written with `-`, as most hand-written Markdown is. Milkdown loads
 * with the knowledge page only, never in the console's main bundle.
 */

import '@milkdown/kit/prose/view/style/prosemirror.css';
import './knowledge-editor.css';

import { defaultValueCtx, Editor, editorViewOptionsCtx, rootCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark, headingIdGenerator } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { $inputRule, $node, $remark, getMarkdown } from '@milkdown/kit/utils';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { headingSlug, parseWikiTarget, WIKILINK } from '@/lib/knowledge-format';
import { cn } from '@/lib/utils';

/** Where a `[[link]]` goes: a console path, or null for a title no document has (a broken link). */
export type WikiResolver = (raw: string) => string | null;

interface MdNode {
  type: string;
  value?: string;
  target?: string;
  children?: MdNode[];
}

/** Splits every text node's `[[…]]` into a wikiLink node, outside code, where remark leaves text as text. */
function splitWikiLinks(node: MdNode) {
  if (!node.children) return;
  const out: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value?.includes('[[')) {
      const value = child.value;
      let last = 0;
      for (const m of value.matchAll(WIKILINK)) {
        if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
        out.push({ type: 'wikiLink', target: m[1] });
        last = m.index + m[0].length;
      }
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
    } else {
      splitWikiLinks(child);
      out.push(child);
    }
  }
  node.children = out;
}

const remarkWikiLink = $remark('remarkWikiLink', () => () => (tree: unknown) => splitWikiLinks(tree as MdNode));

/** The node, with where each link goes read through `resolve` as it is drawn. */
function wikiLinkNode(resolve: { current: WikiResolver }) {
  return $node('wikiLink', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { target: { default: '' } },
    parseDOM: [{ tag: 'a[data-wikilink]', getAttrs: (dom) => ({ target: (dom as HTMLElement).getAttribute('data-wikilink') ?? '' }) }],
    toDOM: (node) => {
      const raw = String(node.attrs.target);
      const href = resolve.current(raw);
      return ['a', { 'data-wikilink': raw, href: href ?? '#', class: href ? 'knowledge-wikilink' : 'knowledge-wikilink knowledge-wikilink-broken' }, parseWikiTarget(raw).label || raw];
    },
    parseMarkdown: {
      match: (node) => node.type === 'wikiLink',
      runner: (state, node, type) => {
        state.addNode(type, { target: (node as unknown as MdNode).target ?? '' });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'wikiLink',
      runner: (state, node) => {
        state.addNode('wikiLink', undefined, undefined, { target: node.attrs.target });
      },
    },
  }));
}

export interface KnowledgeEditorHandle {
  /** The body as Markdown, as it would be saved now. */
  markdown(): string;
}

export const KnowledgeEditor = forwardRef<KnowledgeEditorHandle, {
  /** The document's body, front matter split off. */
  body: string;
  readOnly: boolean;
  resolve: WikiResolver;
  /** Opens a console path a link points to, so the page changes without a reload. */
  onNavigate: (href: string) => void;
  /** Called once the editor has the body, with the body as it would save with no edit: its normalisation. */
  onReady?: (normalised: string) => void;
  className?: string;
  label?: string;
}>(function KnowledgeEditor({ body, readOnly, resolve, onNavigate, onReady, className, label }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const resolver = useRef(resolve);
  const navigate = useRef(onNavigate);
  const ready = useRef(onReady);
  useEffect(() => {
    resolver.current = resolve;
    navigate.current = onNavigate;
    ready.current = onReady;
  });

  useImperativeHandle(ref, () => ({ markdown: () => editor.current?.action(getMarkdown()) ?? body }), [body]);

  // One editor for one body and mode: switching between reading and editing makes a new one, so what is
  // shown is always the text as loaded.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let live = true;
    const wikiLink = wikiLinkNode(resolver);
    // Typing `[[Title]]` makes a link, as opening a file with one does.
    const typedLink = $inputRule((ctx) => new InputRule(/\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => state.tr.replaceWith(start, end, wikiLink.type(ctx).create({ target: match[1] }))));
    const made = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host);
        ctx.set(defaultValueCtx, body);
        ctx.set(headingIdGenerator.key, (node) => headingSlug(node.textContent));
        ctx.update(editorViewOptionsCtx, (options) => ({ ...options, editable: () => !readOnly, attributes: { class: 'knowledge-document', ...(label ? { 'aria-label': label } : {}) } }));
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet: '-' as const,
          handlers: { ...options.handlers, wikiLink: (node: MdNode) => `[[${node.target ?? ''}]]` },
        }));
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(remarkWikiLink)
      .use(wikiLink)
      .use(typedLink);
    void made.create().then((created) => {
      if (!live) {
        void created.destroy();
        return;
      }
      editor.current = created;
      ready.current?.(created.action(getMarkdown()));
    });
    return () => {
      live = false;
      // One still being made is destroyed once it is made, above.
      const current = editor.current;
      editor.current = null;
      if (current) void current.destroy();
    };
  }, [body, readOnly, label]);

  // A link inside the console opens without a reload; one to another site opens beside it. While editing, a
  // click places the cursor instead.
  function click(event: React.MouseEvent) {
    const link = (event.target as Element).closest('a[href]');
    if (!link || !readOnly) {
      if (link) event.preventDefault();
      return;
    }
    const href = link.getAttribute('href') ?? '';
    if (link.hasAttribute('data-wikilink')) {
      event.preventDefault();
      if (href !== '#') navigate.current(href);
    } else if (/^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  return <div ref={root} onClick={click} className={cn('knowledge-editor', !readOnly && 'knowledge-editing', className)} />;
});
