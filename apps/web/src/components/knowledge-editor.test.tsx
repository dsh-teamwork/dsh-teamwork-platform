// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { joinFrontMatter, splitFrontMatter } from '@/lib/knowledge-format';

import { KnowledgeEditor, type KnowledgeEditorHandle } from './knowledge-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

/** Opens `body` in the editor and answers what it would save with no edit. */
async function open(body: string, readOnly = false): Promise<{ normalised: string; handle: KnowledgeEditorHandle; html: string }> {
  host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const handle = createRef<KnowledgeEditorHandle>();
  let normalised = '';
  await act(async () => {
    root.render(createElement(KnowledgeEditor, {
      ref: handle,
      body,
      readOnly,
      resolve: (raw) => (raw.startsWith('Pricing') ? '/teams/t/knowledge/doc1' : null),
      onNavigate: () => undefined,
      onReady: (text) => {
        normalised = text;
      },
    }));
    for (let i = 0; i < 50 && !normalised; i++) await new Promise((r) => setTimeout(r, 10));
  });
  const html = host.innerHTML;
  return { normalised, handle: handle.current!, html };
}

describe('the knowledge editor', () => {
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
});
