import { describe, expect, it } from 'vitest';
import { isThinking, rowsOf, toolKey } from '../conversation';
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
    expect(rows[1]).toMatchObject({ kind: 'steps', status: 'failed', tools: [{ id: 'a' }, { id: 'b' }] });
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
