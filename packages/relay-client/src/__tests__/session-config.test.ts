import { expect, it } from 'vitest';
import { configurationOf, directoriesOf } from '../session-config';

it('keeps full paths so equal folder names never select the wrong project', () => {
  expect(
    directoriesOf({
      items: [
        { cwd: '/a/site', updatedAt: 1 },
        { cwd: '/b/site', updatedAt: 3 },
        { cwd: '/a/site', updatedAt: 2 },
      ],
    }),
  ).toEqual([
    { path: '/b/site', name: 'site' },
    { path: '/a/site', name: 'site' },
  ]);
});
it('reads native model capabilities and the desktop-confirmed session selection', () => {
  const value = configurationOf(
    { items: [] },
    {
      default: { provider: 'p', model: 'm' },
      groups: [
        {
          id: 'p',
          name: 'Provider',
          models: [{ id: 'm', name: 'Coder', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }],
        },
      ],
      failures: [{ name: 'Offline provider' }],
    },
    {
      presets: [],
      current: {
        sessionId: 's',
        cwd: '/work',
        agentPreset: null,
        model: { provider: 'p', model: 'm', reasoningEffort: 'high' },
        started: true,
        running: false,
      },
    },
  );
  expect(value.models[0]).toMatchObject({ provider: 'p', id: 'm', reasoning: { efforts: [{ id: 'high' }] } });
  expect(value.current?.model?.reasoningEffort).toBe('high');
  expect(value.modelFailures).toEqual(['Offline provider']);
});
