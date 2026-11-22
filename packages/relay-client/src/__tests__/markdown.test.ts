import { describe, expect, it } from 'vitest';

import { fileReference } from '../conversation';
import { parseMarkdown } from '../markdown';
import { chunks, reply } from './markdown-fixture.json';

describe('reading an agent’s Markdown', () => {
  it('preserves the environment check table, Chinese prose and file references for the native renderer', () => {
    const tree = parseMarkdown(reply);
    const table = tree.children.find((node) => node.type === 'element' && node.tagName === 'table');
    expect(table).toMatchObject({
      children: expect.arrayContaining([
        expect.objectContaining({ tagName: 'thead' }),
        expect.objectContaining({ tagName: 'tbody' }),
      ]),
    });
    const serialized = JSON.stringify(table);
    expect(serialized).toContain('\u670d\u52a1\u5728\u7ebf');
    expect(serialized).toContain('/root/dshworkspace');
    expect(serialized).toContain('"href":"src/check.ts:12"');
    expect(fileReference('src/check.ts:12')).toEqual({ path: 'src/check.ts', line: 12 });
    expect(fileReference('file:///%ZZ')).toBeNull();
  });

  it('promotes a streamed header to a table and keeps an unfinished fence as code after replay', () => {
    const tags = (count: number) => parseMarkdown(chunks.slice(0, count).join('')).children
      .flatMap((node) => node.type === 'element' ? [node.tagName] : []);
    expect(tags(1)).toEqual(['p', 'p']);
    expect(tags(2)).toEqual(['p', 'table']);
    expect(tags(3)).toEqual(['p', 'table']);
    expect(tags(4)).toEqual(['p', 'table', 'pre']);
  });

  it('produces native render nodes for nested lists, task lists, references and strikethrough', () => {
    const tree = parseMarkdown('- [x] ~~Old~~\n  - [docs][ref]\n\n[ref]: https://example.com');
    expect(tree).toMatchObject({
      children: [{
        tagName: 'ul',
        children: expect.arrayContaining([
          expect.objectContaining({
            tagName: 'li',
            children: expect.arrayContaining([
              expect.objectContaining({ tagName: 'input', properties: { checked: true, disabled: true, type: 'checkbox' } }),
              expect.objectContaining({ tagName: 'del' }),
              expect.objectContaining({ tagName: 'ul' }),
            ]),
          }),
        ]),
      }],
    });
    expect(JSON.stringify(tree)).toContain('"href":"https://example.com"');
  });

  it('renders an unclosed fence as code during streaming and omits raw HTML', () => {
    expect(parseMarkdown('<script>ignored</script>\n\n```sh\nnpm run').children).toMatchObject([{
      tagName: 'pre',
      children: [{ tagName: 'code', properties: { className: ['language-sh'] }, children: [{ value: 'npm run\n' }] }],
    }]);
  });
});
