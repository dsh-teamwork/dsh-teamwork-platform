import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from '../markdown';

describe('reading an agent’s Markdown', () => {
  it('splits a reply into headings, paragraphs, lists, quotes, rules and code', () => {
    const reply = [
      '## Plan',
      'First I will read the tests,',
      'then fix them.',
      '',
      '1. Run `pnpm test`',
      '2. Fix the **flaky** one',
      '   on CI too',
      '- a',
      '* b',
      '> careful',
      '> here',
      '---',
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;',
      '```',
    ].join('\n');
    expect(parseBlocks(reply)).toEqual([
      { type: 'heading', level: 2, text: 'Plan' },
      { type: 'paragraph', text: 'First I will read the tests,\nthen fix them.' },
      { type: 'list', ordered: true, start: 1, items: ['Run `pnpm test`', 'Fix the **flaky** one on CI too'] },
      { type: 'list', ordered: false, start: 1, items: ['a', 'b'] },
      { type: 'quote', text: 'careful\nhere' },
      { type: 'rule' },
      { type: 'code', language: 'ts', text: 'const a = 1;\n\nconst b = 2;' },
    ]);
  });

  it('draws an unclosed fence as code while the reply is still streaming', () => {
    expect(parseBlocks('Here:\n```sh\nnpm run')).toEqual([
      { type: 'paragraph', text: 'Here:' },
      { type: 'code', language: 'sh', text: 'npm run' },
    ]);
  });

  it('styles bold, italic, inline code and http links, and leaves the rest as typed', () => {
    expect(parseInline('Run `ls` **now**, *carefully* and see [docs](https://example.com) or [x](javascript:alert(1))')).toEqual([
      { text: 'Run ' },
      { text: 'ls', code: true },
      { text: ' ' },
      { text: 'now', bold: true },
      { text: ', ' },
      { text: 'carefully', italic: true },
      { text: ' and see ' },
      { text: 'docs', href: 'https://example.com' },
      { text: ' or x)' },
    ]);
    expect(parseInline('2 * 3 = 6 and read_me_now')).toEqual([{ text: '2 * 3 = 6 and read_me_now' }]);
  });
});
