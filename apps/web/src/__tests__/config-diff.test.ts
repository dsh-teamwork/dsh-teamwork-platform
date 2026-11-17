import { describe, expect, it } from 'vitest';

import { diffResource, readValue } from '@/lib/config-diff';

const names = new Map([
  ['model-1', 'Coder'],
  ['plugin-1', '@acme/lint'],
]);

describe('a resource change, field by field', () => {
  it('lists only what differs, name first and long text last', () => {
    const before = { name: 'Review', data: { systemPrompt: 'Be brief.', requiredTools: ['read'], modelConfigId: 'model-1' } };
    const after = { name: 'PR review', data: { systemPrompt: 'Be brief.\nCite the line.', requiredTools: ['read'], modelConfigId: 'model-1', description: 'Reviews a PR' } };
    expect(diffResource(before, after, names)).toEqual([
      { key: 'name', before: 'Review', after: 'PR review', long: false },
      { key: 'description', before: '', after: 'Reviews a PR', long: false },
      { key: 'systemPrompt', before: 'Be brief.', after: 'Be brief.\nCite the line.', long: true },
    ]);
  });

  it('shows every set field of a resource that does not exist yet', () => {
    const changes = diffResource(null, { name: 'New', data: { inheritModel: true, optionalTools: [] } });
    expect(changes.map((c) => c.key)).toEqual(['name', 'inheritModel']);
  });

  it('keeps a field the console does not know, after the known ones', () => {
    const changes = diffResource({ name: 'A', data: { zeta: 1 } }, { name: 'A', data: { zeta: 2, version: '1.0.1' } });
    expect(changes.map((c) => c.key)).toEqual(['version', 'zeta']);
  });

  it('reads ids as names and plugin dependencies as name@version', () => {
    expect(readValue('model-1', names)).toBe('Coder');
    expect(readValue([{ pluginConfigId: 'plugin-1', version: '2.3.1' }, { pluginConfigId: 'gone' }], names)).toBe('@acme/lint@2.3.1, gone');
    expect(readValue(null, names)).toBe('');
  });
});
