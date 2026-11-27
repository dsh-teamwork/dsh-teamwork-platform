import { describe, expect, it } from 'vitest';

import { assetName, isBehind, isRecommended, reachOf, type AssetChoiceState } from '../asset-choices';

const none: AssetChoiceState = { personal: {}, defaults: {} };
const team = { id: 't', name: 'Team preset', version: 3 };
const member = { id: 'm', name: 'Member preset', version: 4, assetOwnerId: 'u2' };

describe('reachOf', () => {
  it('puts the team’s own on every DSH at its latest version until the member removes it', () => {
    expect(reachOf(team, none)).toEqual({ on: true, version: 3, how: 'team' });
    expect(reachOf(team, { ...none, personal: { t: { mode: 'removed' } } })).toEqual({ on: false });
  });
  it('puts a member’s item on a DSH only by choice, or at the version the team recommends', () => {
    expect(reachOf(member, none)).toEqual({ on: false });
    expect(reachOf(member, { ...none, defaults: { m: { version: 2, name: 'Reviewer' } } })).toEqual({ on: true, version: 2, how: 'recommended' });
    expect(reachOf(member, { ...none, personal: { m: { mode: 'latest' } } })).toEqual({ on: true, version: 4, how: 'latest' });
  });
  it('says a pinned item can update only while it is still offered', () => {
    const pinned: AssetChoiceState = { ...none, personal: { m: { mode: 'pinned', version: 2 } } };
    expect(reachOf(member, pinned)).toEqual({ on: true, version: 2, how: 'pinned', update: true });
    expect(reachOf({ ...member, assetArchived: true }, pinned).update).toBe(false);
  });
});

describe('the team’s recommendation', () => {
  const recommended: AssetChoiceState = { ...none, defaults: { m: { version: 2, name: 'Reviewer' } } };
  it('recommends the team’s own and a member’s it chose, never a withdrawn one', () => {
    expect(isRecommended(team, none)).toBe(true);
    expect(isRecommended(member, none)).toBe(false);
    expect(isRecommended(member, recommended)).toBe(true);
    expect(isRecommended({ ...member, assetArchived: true }, recommended)).toBe(false);
  });
  it('is behind once the author published past it, and names the item as recommended', () => {
    expect(isBehind(member, recommended)).toBe(true);
    expect(isBehind(team, recommended)).toBe(false);
    expect(assetName(member, recommended)).toBe('Reviewer');
    expect(assetName(member, none)).toBe('Member preset');
  });
});
