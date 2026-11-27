/**
 * How a team's preset or plugin reaches a member's DSH (docs/tech/team-assistant.md): the team's own and the ones an
 * admin recommends are on everyone's DSH until they remove them; a member's other items are added by choice and
 * follow their latest version unless pinned. The web console's Presets and plugins page and the closed phone app read
 * an item the same way from `GET …/configs` and `GET …/asset-choices`.
 */

/** What these rules read of a preset or plugin (`Config`). */
export interface AssetItem {
  id: string;
  name: string;
  version: number;
  /** The member who owns it; absent for the team's own. */
  assetOwnerId?: string;
  /** Withdrawn by its author or an admin: still on the DSH of whoever has it. */
  assetArchived?: boolean;
}

/** What these rules read of `AssetChoices`: the reader's own choices and the team's recommendations, by item id. */
export interface AssetChoiceState {
  personal: Record<string, { mode: 'latest' | 'pinned' | 'removed' | 'default'; version?: number }>;
  defaults: Record<string, { version: number; name: string }>;
}

/** How the item reaches the reader's DSH, if it does: the team's own, the team's recommendation, or their own choice. */
export interface AssetUse {
  on: boolean;
  version?: number;
  how?: 'team' | 'recommended' | 'latest' | 'pinned';
  /** Pinned below the latest version of an item still offered. */
  update?: boolean;
}

export function reachOf(item: AssetItem, choices: AssetChoiceState): AssetUse {
  const personal = choices.personal[item.id];
  if (personal?.mode === 'removed') return { on: false };
  if (personal?.mode === 'latest') return { on: true, version: item.version, how: 'latest' };
  if (personal?.mode === 'pinned' && personal.version) {
    return { on: true, version: personal.version, how: 'pinned', update: personal.version < item.version && !item.assetArchived };
  }
  if (!item.assetOwnerId) return { on: true, version: item.version, how: 'team' };
  const recommended = choices.defaults[item.id]?.version;
  return recommended ? { on: true, version: recommended, how: 'recommended' } : { on: false };
}

/** On everyone's DSH unless they remove it: the team's own, or a member's the team recommends. */
export const isRecommended = (item: AssetItem, choices: AssetChoiceState) =>
  !item.assetArchived && (!item.assetOwnerId || (choices.defaults[item.id]?.version ?? 0) > 0);

/** A recommendation an admin has not moved to the version its author published since. */
export const isBehind = (item: AssetItem, choices: AssetChoiceState) => {
  const recommended = choices.defaults[item.id]?.version ?? 0;
  return !!item.assetOwnerId && !item.assetArchived && recommended > 0 && recommended < item.version;
};

/** The name the team recommends it under, else its own. */
export const assetName = (item: AssetItem, choices: AssetChoiceState) => choices.defaults[item.id]?.name || item.name;
