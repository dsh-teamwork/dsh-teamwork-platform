import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'use-intl';
import { describe, expect, it, vi } from 'vitest';

import { rowsOf, snapshotOf } from '@dsh-teamwork/relay-client';
import fixture from '../../../../../packages/relay-client/src/__tests__/fixtures/execution-records.json';
import messages from '@/messages/en.json';
import thinkingFixture from '../../../../../packages/relay-client/src/__tests__/fixtures/thinking-deliverables.json';
import { changesByTurn, SessionSteps, TurnFiles, turnTails, WorkToggle } from './session-work';

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
        <TurnFiles turn={1} delivered={[artifact]} openFile={vi.fn()} />
      </IntlProvider>,
    );
    expect(html).toContain('Thinking details');
    expect(html).toContain('<strong>test results</strong>');
    expect(html).not.toContain('Opaque provider signature');
    expect(html).toContain('Workspace check report');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });
});

describe('turn tails', () => {
  it("keeps each turn's latest summary of its changes", () => {
    expect(changesByTurn([
      { kind: 'changes', id: 'seq-5', turn: 1, seq: 5 },
      { kind: 'changes', id: 'seq-9', turn: 1, seq: 9 },
      { kind: 'changes', id: 'seq-7', turn: 2, seq: 7 },
    ])).toEqual(new Map([[1, 9], [2, 7]]));
  });

  const steps = (id: string, turn: number) => ({ kind: 'steps' as const, id, entries: [{ kind: 'tool' as const, id, name: 'write', summary: 'a.ts', status: 'done' as const, turn }], count: 1, status: 'done' as const });
  const delivered = (id: string, turn: number) => ({ kind: 'deliverable' as const, id, turn, file: { path: `${id}.pdf` } });

  it("puts a turn's changed and delivered files after its last row, before the next message", () => {
    const entries = turnTails([
      { kind: 'user', id: 'u1', text: 'go' },
      steps('s1', 1),
      { kind: 'assistant', id: 'a1', text: 'done' },
      delivered('d1', 1),
      delivered('d2', 1),
      { kind: 'user', id: 'u2', text: 'again' },
      steps('s2', 2),
    ], new Set([1]), new Map([[1, 40], [2, 41]]));
    expect(entries.map((e) => (e.kind === 'row' ? e.row.id : `tail${e.turn}:${e.delivered.map((d) => d.id).join(',')}:${e.changes}`)))
      .toEqual(['u1', 's1', 'a1', 'tail1:d1,d2:40', 'u2', 's2']);
  });

  it('shows what a turn changed only once it has ended', () => {
    const entries = turnTails([steps('s1', 1)], new Set(), new Map([[1, 40]]));
    expect(entries.every((e) => e.kind === 'row')).toBe(true);
  });
});
