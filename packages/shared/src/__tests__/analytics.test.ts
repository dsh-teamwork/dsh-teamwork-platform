/**
 * docs/ops/analytics.md is how an agent reading PostHog learns what an event
 * means without the source, so its table has to be exactly `ANALYTICS_EVENTS`:
 * a missing row is an event nobody can interpret, and a stale one sends a query
 * after something that never arrives. The server's refusal of an undeclared
 * property is pinned too, because it is the only thing standing between a
 * careless call and a person's own words in a third party's database.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANALYTICS_EVENTS } from '../analytics';

const DOC = path.resolve(import.meta.dirname, '../../../../docs/ops/analytics.md');

function documentedEvents(): Map<string, string[]> {
  const section = readFileSync(DOC, 'utf8').split(/^## /m).find((s) => s.startsWith('3. Events'));
  if (!section) throw new Error('docs/ops/analytics.md has no "## 3. Events" section');
  const rows = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const name = /^`([a-z_]+)`$/.exec(cells[1] ?? '')?.[1];
    if (!name) continue;
    // The properties column names each key first, in backticks; the values
    // that follow a key are in backticks too, inside its parentheses.
    const props = [...(cells[4] ?? '').replace(/\([^)]*\)/g, '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!);
    rows.set(name, props);
  }
  return rows;
}

describe('the analytics event table', () => {
  const documented = documentedEvents();

  it('documents every event, and nothing else', () => {
    expect([...documented.keys()].sort()).toEqual(Object.keys(ANALYTICS_EVENTS).sort());
  });

  it('names each event\'s properties exactly', () => {
    for (const [name, spec] of Object.entries(ANALYTICS_EVENTS)) {
      expect(documented.get(name)?.sort(), name).toEqual(Object.keys(spec.properties.shape).sort());
    }
  });

  it('names events object_verb, in snake_case', () => {
    for (const name of Object.keys(ANALYTICS_EVENTS)) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });
});

const capture = vi.fn();
vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = capture;
  },
}));

describe('captureServerEvent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    capture.mockReset();
  });

  async function load() {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    return import('../server/analytics');
  }

  it('sends a declared event under the user id, without GeoIP', async () => {
    const { captureServerEvent } = await load();
    captureServerEvent('u1', 'user_signed_up', { via: 'google', client: 'web' });
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'u1',
      event: 'user_signed_up',
      properties: { via: 'google', client: 'web' },
      disableGeoip: true,
    });
  });

  it('refuses a property the event does not declare, and says so', async () => {
    const { captureServerEvent } = await load();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // @ts-expect-error — `email` is not a property of user_signed_up.
    captureServerEvent('u1', 'user_signed_up', { via: 'google', client: 'web', email: 'a@example.com' });
    expect(capture).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('sends nothing without a key', async () => {
    const { captureServerEvent } = await import('../server/analytics');
    captureServerEvent('u1', 'user_signed_up', { via: 'email', client: 'plugin' });
    expect(capture).not.toHaveBeenCalled();
  });
});
