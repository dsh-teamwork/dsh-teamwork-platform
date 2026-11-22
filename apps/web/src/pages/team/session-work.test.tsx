import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'use-intl';
import { describe, expect, it, vi } from 'vitest';

import { rowsOf, snapshotOf } from '@dsh-teamwork/relay-client';
import fixture from '../../../../../packages/relay-client/src/__tests__/fixtures/execution-records.json';
import messages from '@/messages/en.json';
import thinkingFixture from '../../../../../packages/relay-client/src/__tests__/fixtures/thinking-deliverables.json';
import { DeliverableCard, SessionSteps, WorkToggle } from './session-work';

describe('session execution records', () => {
  it('renders the shared fixture with collapsed groups, file links, exit status and bounded output', () => {
    const rows = rowsOf(snapshotOf(fixture).items);
    const work = rows.find((row) => row.kind === 'work')!;
    const groups = rows.filter((row) => row.kind === 'steps');
    const html = renderToStaticMarkup(
      <IntlProvider locale="en" timeZone="UTC" messages={messages}>
        <WorkToggle count={work.count} open={false} onToggle={vi.fn()} />
        {groups.map((row) => <SessionSteps key={row.id} row={row} openFile={vi.fn()} />)}
      </IntlProvider>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('src/check notes.ts:120</button>');
    expect(html).toContain('report.md</button>');
    expect(html).toContain('Exit code 2');
    expect(html).toContain('Output truncated');
    expect(html).toContain('>denied<');
  });

  it('renders the same thinking and file sample with reasoning in a disclosure and deliverables actionable', () => {
    const rows = rowsOf(snapshotOf(thinkingFixture).items);
    const group = rows.find((row) => row.kind === 'steps')!;
    const artifact = rows.find((row) => row.kind === 'deliverable')!;
    const html = renderToStaticMarkup(
      <IntlProvider locale="en" timeZone="UTC" messages={messages}>
        <SessionSteps row={group} />
        <DeliverableCard row={artifact} openFile={vi.fn()} />
      </IntlProvider>,
    );
    expect(html).toContain('Thinking details');
    expect(html).toContain('<strong>test results</strong>');
    expect(html).not.toContain('Opaque provider signature');
    expect(html).toContain('Workspace check report');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });
});
