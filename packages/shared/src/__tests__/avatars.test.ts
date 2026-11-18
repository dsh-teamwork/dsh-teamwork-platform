import { describe, expect, it } from 'vitest';

import { PRESET_AVATAR_ID, PRESET_AVATARS, presetAvatar } from '../avatars';

describe('PRESET_AVATARS', () => {
  it('has unique ids the server accepts', () => {
    const ids = PRESET_AVATARS.map((avatar) => avatar.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(PRESET_AVATAR_ID);
  });

  // A stored id is the contract: dropping or renaming one changes every preset that chose it.
  it('keeps every published id', () => {
    expect(PRESET_AVATARS.map((avatar) => avatar.id)).toEqual(
      expect.arrayContaining(['assistant', 'finance', 'admin', 'hr', 'marketing', 'sales', 'engineer', 'product', 'legal', 'design', 'support', 'operations', 'project', 'training', 'developer', 'researcher', 'analyst', 'writer']),
    );
  });
});

describe('presetAvatar', () => {
  it('shows the chosen avatar', () => {
    expect(presetAvatar('legal', 'any').id).toBe('legal');
  });

  // Appending an avatar to the library re-picks every preset that chose none; these pin it so that is deliberate.
  it.each([
    [undefined, 'Writer', 'project'],
    [null, 'Data analyst', 'product'],
    ['', '\u7814\u7a76\u5458', 'sales'],
    ['retired-avatar', 'Writer', 'project'],
  ])('falls back from %j to one picked from %s', (chosen, seed, expected) => {
    expect(presetAvatar(chosen, seed).id).toBe(expected);
  });
});
