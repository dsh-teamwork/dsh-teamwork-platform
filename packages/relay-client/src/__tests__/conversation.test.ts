import { describe, expect, it } from 'vitest';
import { fileReference, isThinking, rowsOf, toolKey, touchedFiles } from '../conversation';
import type { ConversationItem } from '../types';

const tool = (id: string, name: string, status: 'running' | 'done' | 'failed' | 'denied' = 'done'): ConversationItem => ({ kind: 'tool', id, name, summary: '', status });

describe('laying out a conversation', () => {
  it('folds consecutive tool calls into one row of steps, and drops the question tool its card replaces', () => {
    const rows = rowsOf([
      { kind: 'user', id: 'u', text: 'fix it' },
      tool('a', 'read'),
      tool('q', 'ask_user_question'),
      tool('b', 'bash', 'failed'),
      { kind: 'assistant', id: 'r', text: 'done' },
      tool('c', 'bash', 'running'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['user', 'steps', 'assistant', 'steps']);
    expect(rows[1]).toMatchObject({ kind: 'steps', status: 'failed', entries: [{ id: 'a' }, { id: 'b' }] });
    expect(rows[3]).toMatchObject({ status: 'running' });
  });

  it('says the agent is thinking only while it runs with nothing being written or run', () => {
    const user = rowsOf([{ kind: 'user', id: 'u', text: 'go' }]);
    expect(isThinking(user, true)).toBe(true);
    expect(isThinking(user, false)).toBe(false);
    expect(isThinking(rowsOf([tool('a', 'bash', 'running')]), true)).toBe(false);
    expect(isThinking(rowsOf([tool('a', 'bash')]), true)).toBe(true);
    expect(isThinking(rowsOf([{ kind: 'assistant', id: 'r', text: 'Writing' }]), true)).toBe(false);
  });

  it('names common tools in the reader’s words, and leaves others as DSH calls them', () => {
    expect(toolKey('bash')).toBe('tools.command');
    expect(toolKey('str_replace_editor')).toBe('tools.edit');
    expect(toolKey('jira_search')).toBeNull();
  });
});

describe('a published artifact in the conversation', () => {
  it('is a row of its own, between the steps before and after it', () => {
    const tool = (id: string) => ({ kind: 'tool' as const, id, name: 'bash', summary: '', status: 'done' as const });
    const artifact = { kind: 'artifact' as const, id: 'artifact-2', artifact: { teamId: 't', artifactId: 'a', version: 1, title: 'Q4', kind: 'html' as const } };
    expect(rowsOf([tool('1'), tool('2'), artifact, tool('3')]).map((r) => r.kind)).toEqual(['steps', 'artifact', 'steps']);
  });
});

describe('touchedFiles', () => {
  it('lists the files a session wrote or edited, the latest first and each once, leaving out failed calls', () => {
    const tool = (id: string, name: string, summary: string, status: 'done' | 'failed' | 'running' = 'done') => ({ kind: 'tool' as const, id, name, summary, status });
    expect(touchedFiles([
      tool('1', 'write', 'src/a.ts'),
      tool('2', 'bash', 'npm test'),
      tool('3', 'edit', 'src/b.ts', 'failed'),
      tool('4', 'str_replace_editor', 'src/c.ts'),
      tool('5', 'edit', 'src/a.ts'),
      tool('6', 'read', 'README.md'),
    ])).toEqual(['src/a.ts', 'src/c.ts']);
  });
});

describe('fileReference', () => {
  it('reads paths and file names, with a line where one is given', () => {
    expect(fileReference('src/app.ts')).toEqual({ path: 'src/app.ts' });
    expect(fileReference('README.md')).toEqual({ path: 'README.md' });
    expect(fileReference(' src/app.ts:42 ')).toEqual({ path: 'src/app.ts', line: 42 });
    expect(fileReference('server/relay/relay.go:120:7')).toEqual({ path: 'server/relay/relay.go', line: 120 });
    expect(fileReference('/home/me/project/Makefile')).toEqual({ path: '/home/me/project/Makefile' });
    expect(fileReference('file:///home/me/notes%20one.md')).toEqual({ path: '/home/me/notes one.md' });
    expect(fileReference('C:\\work\\app.ts:3')).toEqual({ path: 'C:\\work\\app.ts', line: 3 });
    expect(fileReference('src/check.ts#L120-L125')).toEqual({ path: 'src/check.ts', line: 120 });
    expect(fileReference('file:///home/me/notes%20one.md#L42')).toEqual({ path: '/home/me/notes one.md', line: 42 });
    expect(fileReference('src/check.ts:120-125')).toEqual({ path: 'src/check.ts', line: 120 });
    expect(fileReference('//example.com/src/check.ts#L120')).toBeNull();
    expect(fileReference('.env')).toEqual({ path: '.env' });
  });

  it('leaves out what is not a file', () => {
    for (const text of ['https://example.com/a.ts', 'mailto:a@b.c', '@dsh-teamwork/relay-client', 'npm run build', 'v1.2', '1.2.3', 'useState()',
      'foo', 'a=b.ts', '--flag', '$HOME/x', '~/x.md', 'src/', '', 'TODO.', 'e.g.', 'a.ts, b.ts'])
      expect(fileReference(text)).toBeNull();
  });
});
