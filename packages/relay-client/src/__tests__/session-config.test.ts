import { expect, it } from 'vitest';
import { configurationOf, defaultDirectory, directoriesOf, startableDirectories } from '../session-config';

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

it('reads the session\'s permission preset, and none from an older plugin', () => {
  const catalog = { default: { provider: 'p', model: 'm' }, groups: [] };
  const permissions = { current: 'read-only', defaultPreset: 'workspace-write', options: [{ id: 'danger-full-access', name: 'Full access', risky: true, allowed: false }] };
  expect(configurationOf({ items: [] }, catalog, { presets: [], current: null, permissions }).permissions).toEqual(permissions);
  expect(configurationOf({ items: [] }, catalog, { presets: [], current: null }).permissions).toBeNull();
});

it('starts a new session in the team’s default workspace, else in the folder of the latest session', () => {
  const startable = startableDirectories({ items: [{ cwd: '/a', updatedAt: 1 }, { cwd: '/b', updatedAt: 9 }] }, ['/srv/team']);
  expect(defaultDirectory(startable, { t: '/srv/team' }, 't')).toBe('/srv/team');
  expect(defaultDirectory(startable, { t: '/srv/team' })).toBe('/b');
  expect(defaultDirectory(startable, { other: '/srv/team' }, 't')).toBe('/b');
  // A default the computer does not offer is never where a session starts.
  expect(defaultDirectory(startable, { t: '/etc' }, 't')).toBe('/b');
  expect(defaultDirectory([], {}, 't')).toBeUndefined();
});
