// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'use-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { joinFrontMatter, splitFrontMatter } from '@/lib/knowledge-format';
import messages from '@/messages/en.json';

import { KnowledgeEditor, type KnowledgeEditorHandle } from './knowledge-editor';
import { findSlash, mentionItems, slashItems } from './knowledge-slash';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out; ProseMirror measures the cursor to scroll it into view after an insert.
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

/** Every first-version feature (docs/tech/knowledge.md, "Format"), written as the editor writes it. */
const CANONICAL = `# Runbook

Deploys go out from \`main\`; see [[Glossary#Release train]] and [[Pricing]].

## Steps

1. Freeze the branch
2. Run the checks
   - unit tests
   - the end-to-end suite

- [ ] announce the window
- [x] page the on-call

| Service | Owner |        Notes |
| :------ | :---: | -----------: |
| gateway |  ops  | **hot** path |

> Roll back first, ask later.

\`\`\`sh
pnpm build
\`\`\`

An image: ![chart](chart.files/latency.png) and a [link](https://example.com).

![[diagram.png]]

The spec is [[spec.pdf]], the old one [[old spec.pdf|the draft]]; ![[missing.png]] and [[gone.csv]] were never uploaded.

Wow![[Pricing]] embeds a document.
`;

/** The richer format's blocks (docs/tech/knowledge.md, "Format"), written as the editor writes them. */
const RICHER = `# Release

> [!warning] Mind the **cache** and [[Pricing]]
> Purge it before a deploy.
>
> - one
> - two

> [!tip]- Folded until opened
> Hidden until opened.

> [!note]

> [!example] A table first
>
> | a | b |
> | - | - |
> | 1 | 2 |

> [!info]
>
> > [!danger] Nested
> > Inside.

> Still a plain quote.

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

/** The same, written by hand: other list markers, no table padding, a missing blank line. */
const MESSY = `# Runbook
Deploys go out from \`main\`; see [[Glossary#Release train]] and [[Pricing]].

* one
* two

|a|b|
|-|-|
|1|2|
`;

/** The attachments the document holds. */
const FILES = ['diagram.png', 'spec.pdf', 'old spec.pdf', 'data.csv'];

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

/** Working together's syntax (docs/tech/knowledge.md, "Format"), written as the editor writes it. */
const TOGETHER = `Ask @[ada@example.com](user1) or @[Bo](u2gone), not <me@example.com>.

![[artifact:a1]]

See the [[artifact:a2|report]] and [a link](https://example.com).
`;

/** Opens `body` in the editor and answers what it would save with no edit. */
async function open(body: string, readOnly = false, extra: Record<string, unknown> = {}): Promise<{ normalised: string; handle: KnowledgeEditorHandle; html: string }> {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const handle = createRef<KnowledgeEditorHandle>();
  let normalised = '';
  await act(async () => {
    root.render(createElement(IntlProvider, { locale: 'en', timeZone: 'UTC', messages, children: createElement(KnowledgeEditor, {
      ref: handle,
      body,
      readOnly,
      resolve: (raw) => (raw.startsWith('Pricing') ? '/teams/t/knowledge/doc1' : null),
      attachment: (name) => (FILES.includes(name) ? { href: `/files/${encodeURIComponent(name)}`, inline: !name.endsWith('.csv'), size: '12 KB' } : null),
      onNavigate: () => undefined,
      ...extra,
      onReady: (text: string) => {
        normalised = text;
      },
    }) }));
    for (let i = 0; i < 50 && !normalised; i++) await new Promise((r) => setTimeout(r, 10));
  });
  const html = host.innerHTML;
  return { normalised, handle: handle.current!, html };
}

describe('the knowledge editor', () => {
  it('saves callouts and diagrams in their own syntax unchanged', async () => {
    const { normalised, handle } = await open(RICHER);
    expect(normalised).toBe(RICHER);
    expect(handle.markdown()).toBe(RICHER);
  });

  it('reads a callout from a quote Obsidian writes, its body after a blank line too', async () => {
    const { normalised } = await open('> [!WARNING]+  Spaced title\n>\n> Body.\n');
    expect(normalised).toBe('> [!WARNING]+ Spaced title\n> Body.\n');
  });

  it('draws a callout by its kind, folded when its file says so', async () => {
    const { html } = await open(RICHER, true);
    expect(html).toMatch(/class="knowledge-callout" data-callout="warning" data-family="signal" data-fold=""/);
    expect(html).toMatch(/class="knowledge-callout is-folded" data-callout="tip" data-family="success" data-fold="-"/);
    expect(html).toContain('class="knowledge-callout-toggle"');
    // One with no title is named by its kind.
    expect(html).toMatch(/class="knowledge-callout is-untitled" data-callout="note"[^>]*><div class="knowledge-callout-label" contenteditable="false">Note</);
    expect(html).toContain('class="knowledge-diagram is-reading"');
  });

  it('offers its kinds and folding as choices while editing', async () => {
    const { html } = await open(RICHER);
    expect(html).toContain('<select aria-label="Callout type">');
    expect(html).toContain('<option value="-">Foldable, folded</option>');
  });

  it('saves mentions and embedded artifacts as written', async () => {
    const { normalised } = await open(TOGETHER);
    expect(normalised).toBe(TOGETHER);
  });

  it('shows a mention as the team names the member now, and an artifact as its card', async () => {
    const { html } = await open(TOGETHER, true, {
      member: (id: string) => (id === 'user1' ? { name: 'Ada Lovelace', me: true } : null),
      artifact: (id: string) => (id === 'a1' ? { href: '/teams/t/artifacts/a1', title: 'Latency report', note: 'HTML', missing: false } : { href: '#', title: 'An artifact you cannot open', note: '', missing: true }),
    });
    expect(html).toContain('<span class="knowledge-mention is-me" data-mention="user1">@Ada Lovelace</span>');
    expect(html).toContain('<span class="knowledge-mention is-gone" data-mention="u2gone">@Bo</span>');
    expect(html).toMatch(/<a data-wikilink="artifact:a1" data-embed="true" href="\/teams\/t\/artifacts\/a1" class="knowledge-artifact"><span class="knowledge-artifact-title">Latency report<\/span><span class="knowledge-artifact-note">HTML<\/span><\/a>/);
    expect(html).toContain('class="knowledge-artifact knowledge-artifact-missing"');
  });

  it('marks the words a thread quotes, within one block, and says which it placed', async () => {
    let placed: string[] = [];
    const { html } = await open('# Deploys\n\nNo deploys on **Friday** at all.\n', true, {
      comments: [{ id: 'c1', quote: 'deploys on Friday' }, { id: 'c2', quote: 'words this version lacks' }],
      activeComment: 'c1',
      onCommentsPlaced: (ids: string[]) => {
        placed = ids;
      },
    });
    expect(placed).toEqual(['c1']);
    expect(html).toContain('<span data-comment="c1" class="knowledge-comment-mark is-active">deploys on </span><strong><span data-comment="c1" class="knowledge-comment-mark is-active">Friday</span></strong>');
  });

  it('finds a member to mention by name', () => {
    expect(mentionItems('ada', [{ id: 'user1', name: 'ada@example.com' }, { id: 'u2', name: 'bo@example.com' }])).toEqual([{ id: 'user1', name: 'ada@example.com' }]);
    const members = [{ id: 'ada1', name: 'Ada', detail: 'first@example.com' }, { id: 'ada2', name: 'Ada', detail: 'second@example.com' }];
    expect(mentionItems('Ada', members)).toEqual(members);
    expect(mentionItems('second@', members)).toEqual([members[1]]);
  });

  it('keeps a full name in the mention query after an earlier mention trigger', () => {
    const text = '@Previous person @Ada Lovelace';
    const view = {
      editable: true,
      state: {
        selection: {
          empty: true,
          from: text.length + 1,
          $from: { parentOffset: text.length, parent: { isTextblock: true, type: { name: 'paragraph', spec: {} }, textBetween: () => text } },
        },
      },
      coordsAtPos: () => ({ left: 0, bottom: 20 }),
    } as unknown as Parameters<typeof findSlash>[0];
    expect(findSlash(view)).toMatchObject({ kind: 'mention', query: 'Ada Lovelace', from: text.lastIndexOf('@') + 1 });
  });

  it('narrows the block menu by either word, and offers files only with somewhere to put them', () => {
    // A name in the reader's language, here Chinese for callout.
    const name = (id: string) => (id === 'callout' ? '\u6807\u6ce8' : id);
    expect(slashItems('mer', name, { attach: true, artifact: true })).toEqual(['diagram']);
    expect(slashItems('\u6807\u6ce8', name, { attach: true, artifact: true })).toEqual(['callout']);
    expect(slashItems('', name, { attach: false, artifact: false })).not.toContain('attach');
    expect(slashItems('image', name, { attach: true, artifact: false })).toEqual(['attach']);
  });

  it('saves a document in its own syntax unchanged', async () => {
    const { normalised, handle } = await open(CANONICAL);
    expect(normalised).toBe(CANONICAL);
    expect(handle.markdown()).toBe(CANONICAL);
  });

  it('normalises hand-written syntax once, and then keeps it', async () => {
    const first = await open(MESSY);
    expect(first.normalised).not.toBe(MESSY);
    expect(first.normalised).toContain('[[Glossary#Release train]]');
    expect(first.normalised).toContain('- one\n- two');
    host?.remove();
    const second = await open(first.normalised);
    expect(second.normalised).toBe(first.normalised);
  });

  it('keeps front matter outside the editor and puts it back', async () => {
    const text = `---\nowner: ops\ntags: [deploys]\n---\n\n${CANONICAL}`;
    const { frontMatter, body } = splitFrontMatter(text);
    const { normalised } = await open(body);
    expect(joinFrontMatter(frontMatter, normalised)).toBe(text);
  });

  it('draws a link to a known title as a link and an unknown one as broken', async () => {
    const { html } = await open(CANONICAL, true);
    expect(html).toContain('href="/teams/t/knowledge/doc1"');
    expect(html).toMatch(/class="knowledge-wikilink knowledge-wikilink-broken"[^>]*>Glossary › Release train</);
    expect(html).toContain('id="steps"');
    expect(html).toContain('contenteditable="false"');
  });

  it('embeds an attachment image, links its file, and marks what was never uploaded', async () => {
    const { html } = await open(CANONICAL, true);
    expect(html).toContain('<span data-wikilink="diagram.png" data-embed="true" class="knowledge-embed"><img src="/files/diagram.png" alt="diagram.png"></span>');
    expect(html).toMatch(/<a data-wikilink="spec.pdf" href="\/files\/spec.pdf" data-attachment="spec.pdf" class="knowledge-file" target="_blank"[^>]*><span class="knowledge-file-name">spec.pdf<\/span><span class="knowledge-file-size">12 KB<\/span><\/a>/);
    expect(html).toContain('<span class="knowledge-file-name">the draft</span>');
    expect(html).toContain('class="knowledge-embed knowledge-embed-broken">missing.png</span>');
    expect(html).toMatch(/data-wikilink="gone.csv" href="#" class="knowledge-file knowledge-file-broken"/);
    // An embed of a document is still a link to it.
    expect(html).toMatch(/data-wikilink="Pricing" data-embed="true" href="\/teams\/t\/knowledge\/doc1" class="knowledge-wikilink"/);
  });

  it('downloads a file the browser does not show', async () => {
    const { html } = await open('A table: [[data.csv]]\n', true);
    expect(html).toContain('download="data.csv"');
    expect(html).not.toContain('target="_blank"');
  });

  it('inserts an embed or a file link at the cursor, written in its own syntax', async () => {
    const { handle } = await open('Before\n');
    await act(async () => {
      handle.insert('diagram.png', true);
      handle.insert('spec.pdf', false);
    });
    expect(handle.markdown()).toBe('![[diagram.png]][[spec.pdf]]Before\n');
  });

  it('draws an embed again once its file is uploaded, with no change to the text', async () => {
    const { handle } = await open('![[later.png]]\n');
    expect(host!.innerHTML).toContain('knowledge-embed-broken');
    FILES.push('later.png');
    try {
      await act(async () => handle.redraw());
      expect(host!.innerHTML).toContain('<img src="/files/later.png" alt="later.png">');
      expect(handle.markdown()).toBe('![[later.png]]\n');
    } finally {
      FILES.pop();
    }
  });
});
