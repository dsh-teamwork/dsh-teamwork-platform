/**
 * The knowledge editor (docs/tech/knowledge.md, "Format" and "Rendering"):
 * Milkdown with its commonmark and gfm presets, which keeps Markdown as its
 * model, read-only to show a document and editable to change it. It reads and
 * writes Markdown and nothing else: front matter is split off before it opens
 * a document (lib/knowledge-format.ts), and `[[links]]` are an inline node of
 * their own, parsed by a remark plugin and written back exactly as typed.
 * `![[name.png]]` embeds an attachment's image and `[[name.pdf]]` links its
 * file (lib/knowledge-format.ts tells them from a document link by the
 * extension); both are the same node with an `embed` flag, so each is written
 * back exactly as typed. A file pasted or dropped while editing goes to the
 * page, which uploads it and inserts its link at the cursor. Lists are
 * written with `-`, as most hand-written Markdown is. Callouts and diagrams
 * are components/knowledge-blocks.ts, and typing `/` on an empty line opens
 * the block menu (components/knowledge-slash.tsx). Milkdown loads with the
 * knowledge page only, never in the console's main bundle.
 */

import '@milkdown/kit/prose/view/style/prosemirror.css';
import './knowledge-editor.css';

import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, rootCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark, headingIdGenerator } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { DOMSerializer, type DOMOutputSpec, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $inputRule, $node, $prose, $remark, $view, getMarkdown } from '@milkdown/kit/utils';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';

import { headingSlug, isAttachmentName, isImageName, knownCalloutKind, parseWikiTarget, WIKILINK } from '@/lib/knowledge-format';
import { cn } from '@/lib/utils';

import { calloutInputRule, calloutNode, calloutTitleNode, calloutView, codeBlockView, remarkCallout, stringifyCallout, type BlockWords } from './knowledge-blocks';
import { runSlash, slashItems, SlashMenu, slashPlugin, type SlashItemId, type SlashOpen } from './knowledge-slash';

/** Where a `[[link]]` goes: a console path, or null for a title no document has (a broken link). */
export type WikiResolver = (raw: string) => string | null;

/** A file the document holds, as a link draws it, or null when none has that name (a broken embed or link). */
export type AttachmentResolver = (name: string) => {
  href: string;
  /** Shown by the browser (an image or a PDF), rather than downloaded. */
  inline: boolean;
  /** Its size, worded for the reader. */
  size: string;
} | null;

interface MdNode {
  type: string;
  value?: string;
  target?: string;
  embed?: boolean;
  children?: MdNode[];
}

/**
 * Splits every text node's `[[…]]` into a wikiLink node, outside code, where remark leaves text as text. A `!`
 * just before one makes it an embed, `![[…]]`, as Obsidian reads it.
 */
function splitWikiLinks(node: MdNode) {
  if (!node.children) return;
  const out: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value?.includes('[[')) {
      const value = child.value;
      let last = 0;
      for (const m of value.matchAll(WIKILINK)) {
        const embed = m.index > last && value[m.index - 1] === '!';
        const textEnd = embed ? m.index - 1 : m.index;
        if (textEnd > last) out.push({ type: 'text', value: value.slice(last, textEnd) });
        out.push({ type: 'wikiLink', target: m[1], embed });
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

/** What a link draws as. Which element it is depends on its text alone (an image embed is a span, the rest links), so a redraw keeps the element. */
function drawWikiLink(raw: string, embed: boolean, resolve: WikiResolver, attachment: AttachmentResolver): DOMOutputSpec {
  const { title, label } = parseWikiTarget(raw);
  const shown = label || raw;
  const own = { 'data-wikilink': raw, ...(embed ? { 'data-embed': 'true' } : {}) };
  if (isAttachmentName(title)) {
    const file = attachment(title);
    if (embed && isImageName(title)) {
      return file
        ? ['span', { ...own, class: 'knowledge-embed' }, ['img', { src: file.href, alt: shown }]]
        : ['span', { ...own, class: 'knowledge-embed knowledge-embed-broken' }, shown];
    }
    if (!file) return ['a', { ...own, href: '#', class: 'knowledge-file knowledge-file-broken' }, ['span', { class: 'knowledge-file-name' }, shown]];
    return [
      'a',
      { ...own, href: file.href, 'data-attachment': title, class: 'knowledge-file', ...(file.inline ? { target: '_blank', rel: 'noopener' } : { download: title }) },
      ['span', { class: 'knowledge-file-name' }, shown],
      ['span', { class: 'knowledge-file-size' }, file.size],
    ];
  }
  const href = resolve(raw);
  return ['a', { ...own, href: href ?? '#', class: href ? 'knowledge-wikilink' : 'knowledge-wikilink knowledge-wikilink-broken' }, parseWikiTarget(raw).label || raw];
}

interface Resolvers {
  resolve: WikiResolver;
  attachment: AttachmentResolver;
}

/** The node, with where each link goes read through `resolvers` as it is drawn. */
function wikiLinkNode(resolvers: { current: Resolvers }) {
  return $node('wikiLink', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { target: { default: '' }, embed: { default: false } },
    parseDOM: [{ tag: '[data-wikilink]', getAttrs: (dom) => ({ target: (dom as HTMLElement).getAttribute('data-wikilink') ?? '', embed: (dom as HTMLElement).hasAttribute('data-embed') }) }],
    toDOM: (node) => drawWikiLink(String(node.attrs.target), node.attrs.embed === true, resolvers.current.resolve, resolvers.current.attachment),
    parseMarkdown: {
      match: (node) => node.type === 'wikiLink',
      runner: (state, node, type) => {
        const md = node as unknown as MdNode;
        state.addNode(type, { target: md.target ?? '', embed: md.embed === true });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'wikiLink',
      runner: (state, node) => {
        state.addNode('wikiLink', undefined, undefined, { target: node.attrs.target, embed: node.attrs.embed });
      },
    },
  }));
}

/**
 * Draws each link through a node view that can draw it again: a file
 * uploaded while editing turns the embeds already naming it from broken to
 * shown without a change to the text.
 */
function wikiLinkView(node: ReturnType<typeof wikiLinkNode>, resolvers: { current: Resolvers }, views: Set<() => void>) {
  return $view(node, () => (pmNode) => {
    const draw = () => DOMSerializer.renderSpec(document, drawWikiLink(String(pmNode.attrs.target), pmNode.attrs.embed === true, resolvers.current.resolve, resolvers.current.attachment)).dom as HTMLElement;
    const dom = draw();
    const redraw = () => {
      const fresh = draw();
      const selected = dom.classList.contains('ProseMirror-selectednode');
      for (const attr of [...dom.attributes]) dom.removeAttribute(attr.name);
      for (const attr of [...fresh.attributes]) dom.setAttribute(attr.name, attr.value);
      if (selected) dom.classList.add('ProseMirror-selectednode');
      dom.replaceChildren(...fresh.childNodes);
    };
    views.add(redraw);
    return { dom, ignoreMutation: () => true, destroy: () => views.delete(redraw) };
  });
}

/** Every `[[…]]` target in a document, in order, each once. */
function linkTargets(doc: ProseNode): string[] {
  const targets = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'wikiLink') targets.add(String(node.attrs.target));
  });
  return [...targets];
}

export interface KnowledgeEditorHandle {
  /** The body as Markdown, as it would be saved now. */
  markdown(): string;
  /** Puts `[[target]]`, or `![[target]]` for an embed, at the cursor. */
  insert(target: string, embed: boolean): void;
  /** Draws every link again, as the resolvers now answer. */
  redraw(): void;
}

export const KnowledgeEditor = forwardRef<KnowledgeEditorHandle, {
  /** The document's body, front matter split off. */
  body: string;
  readOnly: boolean;
  resolve: WikiResolver;
  attachment: AttachmentResolver;
  /** Opens a console path a link points to, so the page changes without a reload. */
  onNavigate: (href: string) => void;
  /** Called once the editor has the body, with the body as it would save with no edit: its normalisation. */
  onReady?: (normalised: string) => void;
  /** Every `[[…]]` target the text holds, as it opens and whenever it changes. */
  onLinks?: (targets: string[]) => void;
  /** Files pasted or dropped while editing; the cursor is already where they go. */
  onFiles?: (files: File[], pasted: boolean) => void;
  /** Asks for files to attach where the cursor is, from the block menu; without it the menu offers none. */
  onAttach?: () => void;
  className?: string;
  label?: string;
}>(function KnowledgeEditor({ body, readOnly, resolve, attachment, onNavigate, onReady, onLinks, onFiles, onAttach, className, label }, ref) {
  const t = useTranslations('team.knowledge.editor');
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const linkNode = useRef<ReturnType<typeof wikiLinkNode> | null>(null);
  const views = useRef(new Set<() => void>());
  const resolvers = useRef<Resolvers>({ resolve, attachment });
  const navigate = useRef(onNavigate);
  const ready = useRef(onReady);
  const links = useRef(onLinks);
  const files = useRef(onFiles);
  const attachFiles = useRef(onAttach);
  const blockWords = (): BlockWords => ({
    kind: (kind) => {
      const known = knownCalloutKind(kind);
      return known ? t(`kinds.${known}`) : kind;
    },
    kindLabel: t('calloutKind'),
    fold: { none: t('foldNone'), open: t('foldOpen'), closed: t('foldClosed') },
    foldLabel: t('calloutFold'),
    toggle: t('toggleFold'),
    diagramError: t('diagramError'),
  });
  const words = useRef<BlockWords>(blockWords());
  useEffect(() => {
    resolvers.current = { resolve, attachment };
    navigate.current = onNavigate;
    ready.current = onReady;
    links.current = onLinks;
    files.current = onFiles;
    attachFiles.current = onAttach;
    words.current = blockWords();
  });

  // The block menu: where it is open, which item is chosen, and which `/` was dismissed with Escape.
  const [slash, setSlash] = useState<SlashOpen | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef(-1);
  const shownSlash = useRef<SlashOpen | null>(null);
  const slashName = (id: SlashItemId) => t(`slash.${id}`);
  const items = slash ? slashItems(slash.query, slashName, !!onAttach) : [];
  const menu = useRef({ slash, items, active });
  const pick = (id: SlashItemId) => {
    const open = menu.current.slash;
    if (!open) return;
    editor.current?.action((ctx) => runSlash(ctx, open, id, () => attachFiles.current?.()));
    setSlash(null);
  };
  const slashKeys = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const onSlashKey = (event: KeyboardEvent) => {
    const { slash: open, items: shown, active: at } = menu.current;
    if (!open) return false;
    if (event.key === 'Escape') {
      dismissed.current = open.from;
      setSlash(null);
      return true;
    }
    if (shown.length === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at + step + shown.length) % shown.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      pick(shown[Math.min(at, shown.length - 1)]);
      return true;
    }
    return false;
  };
  useEffect(() => {
    menu.current = { slash, items, active };
    slashKeys.current = onSlashKey;
  });

  useImperativeHandle(ref, () => ({
    markdown: () => editor.current?.action(getMarkdown()) ?? body,
    insert: (target, embed) => {
      const node = linkNode.current;
      editor.current?.action((ctx) => {
        if (!node) return;
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.replaceSelectionWith(node.type(ctx).create({ target, embed }), false).scrollIntoView());
        view.focus();
      });
    },
    redraw: () => {
      resolvers.current = { resolve, attachment };
      for (const draw of views.current) draw();
    },
  }), [body, resolve, attachment]);

  // One editor for one body and mode: switching between reading and editing makes a new one, so what is
  // shown is always the text as loaded.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let live = true;
    const wikiLink = wikiLinkNode(resolvers);
    linkNode.current = wikiLink;
    // Typing `[[Title]]` makes a link, and `![[name.png]]` an embed, as opening a file with one does.
    const typedLink = $inputRule((ctx) => new InputRule(/(!?)\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => state.tr.replaceWith(start, end, wikiLink.type(ctx).create({ target: match[2], embed: match[1] === '!' }))));
    let reported = '';
    const report = (doc: ProseNode) => {
      const targets = linkTargets(doc);
      const key = targets.join('\n');
      if (key === reported && reported !== '') return;
      reported = key;
      links.current?.(targets);
    };
    const watchLinks = $prose(() => new Plugin({
      view: (view) => {
        report(view.state.doc);
        return { update: (next, prev) => { if (next.state.doc !== prev.doc) report(next.state.doc); } };
      },
    }));
    const reportSlash = (found: SlashOpen | null) => {
      if (!live) return;
      let open = found;
      if (open && open.from === dismissed.current) open = null;
      else if (!open) dismissed.current = -1;
      const was = shownSlash.current;
      if (was === open || (was && open && was.from === open.from && was.to === open.to && was.query === open.query && was.left === open.left && was.top === open.top)) return;
      if (!open || !was || was.from !== open.from || was.query !== open.query) setActive(0);
      shownSlash.current = open;
      setSlash(open);
    };
    const made = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host);
        ctx.set(defaultValueCtx, body);
        ctx.set(headingIdGenerator.key, (node) => headingSlug(node.textContent));
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          editable: () => !readOnly,
          attributes: { class: 'knowledge-document', ...(label ? { 'aria-label': label } : {}) },
          handlePaste: (_view, event) => {
            const pasted = [...(event.clipboardData?.files ?? [])];
            if (readOnly || pasted.length === 0 || !files.current) return false;
            event.preventDefault();
            files.current(pasted, true);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const dropped = [...(event.dataTransfer?.files ?? [])];
            if (readOnly || moved || dropped.length === 0 || !files.current) return false;
            event.preventDefault();
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (at) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)));
            files.current(dropped, false);
            return true;
          },
        }));
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet: '-' as const,
          handlers: {
            ...options.handlers,
            wikiLink: (node: MdNode) => `${node.embed ? '!' : ''}[[${node.target ?? ''}]]`,
            callout: stringifyCallout as never,
          },
        }));
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(remarkCallout)
      .use(calloutTitleNode)
      .use(calloutNode)
      .use(calloutView(words))
      .use(calloutInputRule)
      .use(codeBlockView(words))
      .use(slashPlugin(reportSlash, slashKeys))
      .use(remarkWikiLink)
      .use(wikiLink)
      .use(wikiLinkView(wikiLink, resolvers, views.current))
      .use(typedLink)
      .use(watchLinks);
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
      shownSlash.current = null;
      setSlash(null);
      // One still being made is destroyed once it is made, above.
      const current = editor.current;
      editor.current = null;
      if (current) void current.destroy();
    };
  }, [body, readOnly, label]);

  // A link inside the console opens without a reload; one to another site, or to a file shown in the browser,
  // opens beside it, and any other file downloads. While editing, a click places the cursor instead.
  function click(event: React.MouseEvent) {
    const link = (event.target as Element).closest('a[href]');
    if (!link || !readOnly) {
      if (link) event.preventDefault();
      return;
    }
    const href = link.getAttribute('href') ?? '';
    if (link.hasAttribute('data-attachment')) return;
    if (link.hasAttribute('data-wikilink')) {
      event.preventDefault();
      if (href !== '#') navigate.current(href);
    } else if (/^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <>
      <div ref={root} onClick={click} className={cn('knowledge-editor', !readOnly && 'knowledge-editing', className)} />
      {slash && <SlashMenu items={items} active={active} top={slash.top} left={slash.left} onPick={pick} onHover={setActive} />}
    </>
  );
});
