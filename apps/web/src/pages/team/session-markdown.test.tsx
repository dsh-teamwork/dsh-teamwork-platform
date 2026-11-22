import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { chunks, reply } from '../../../../../packages/relay-client/src/__tests__/markdown-fixture.json';
import { SessionMarkdown } from './session-markdown';

describe('session Markdown', () => {
  it('renders the environment check as a scrollable table with Chinese content and workspace links', () => {
    const html = renderToStaticMarkup(createElement(SessionMarkdown, { text: reply, openFile: vi.fn() }));
    expect(html).toContain('class="session-markdown-table" tabindex="0"><table>');
    expect(html).toContain('<thead>');
    expect(html.match(/<tr>/g)).toHaveLength(8);
    expect(html).toContain('\u670d\u52a1\u5728\u7ebf');
    expect(html).toContain('<button type="button" class="session-markdown-file font-mono">/root/dshworkspace</button>');
    expect(html).toContain('<button type="button" class="session-markdown-file"><code>src/check.ts:12</code></button>');
  });

  it('promotes a streamed header to a table and enables its file target after the unfinished fence settles', () => {
    const markup = (count: number, settled = false) => renderToStaticMarkup(createElement(SessionMarkdown, {
      text: chunks.slice(0, count).join(''),
      openFile: settled ? vi.fn() : undefined,
    }));
    expect(markup(1)).not.toContain('<table>');
    expect(markup(2)).toContain('<table>');
    expect(markup(3)).toContain('\u670d\u52a1\u5728\u7ebf');
    expect(markup(4)).toContain('<pre><code class="language-sh">');
    expect(markup(4)).not.toContain('<button');
    expect(markup(4, true)).toContain('<button type="button" class="session-markdown-file">\u6253\u5f00\u68c0\u67e5\u8bb0\u5f55</button>');
  });

  it('keeps external links usable and does not turn blocked URLs or unavailable files into links', () => {
    const html = renderToStaticMarkup(createElement(SessionMarkdown, {
      text: '[docs](https://example.com) [blocked](javascript:alert(1)) [file](file:///tmp/check.ts:12)',
    }));
    expect(html).toContain('href="https://example.com"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain('<button');
  });
});
