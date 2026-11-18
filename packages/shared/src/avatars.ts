/**
 * The preset avatars: one vector library the web console and the phone app
 * both draw, so a preset looks the same wherever a member meets it.
 *
 * An avatar is an abstract emblem of a role, not a pictogram of a tool or a
 * drawing of a person: two or three flat shapes (circles, arcs, rounded bars)
 * composed to suggest what the role does (a balance for legal, a stack of
 * coins for finance), in paper and one accent on the role's own plate
 * (docs/design.md, "Preset avatars").
 *
 * Each is drawn on a 32-unit square: the plate is the whole square with the
 * logo's corner, then each layer in order, filled and/or stroked in one of
 * three tones — paper, the avatar's plate (a cut-out) or its accent — with
 * round caps and joins. Shapes stay clear of the plate's rounded corners, so
 * no client needs a clip. Nothing here knows
 * the DOM or React Native.
 *
 * A preset stores the avatar's id (`PresetData.avatar`). The id is the stored
 * contract: an avatar may be redrawn freely, but an id once published is never
 * renamed or reused. The console's editor always stores one; a preset with
 * none (written before avatars, imported from a file, or a DSH's own) or with
 * one this client does not know gets one picked from its name, the one thing
 * every surface shows of it, so the console and the phone draw the same.
 */

export type PresetAvatarTone = 'figure' | 'plate' | 'accent';

export interface PresetAvatarLayer {
  d: string;
  fill?: PresetAvatarTone;
  stroke?: PresetAvatarTone;
  /** Stroke width in units of the 32-unit square; 1 when omitted. */
  width?: number;
}

export interface PresetAvatar {
  id: string;
  plate: string;
  accent: string;
  layers: readonly PresetAvatarLayer[];
}

/** The square every avatar is drawn on, and the paper its shapes are drawn in. */
export const PRESET_AVATAR_STYLE = {
  size: 32,
  /** The logo's corner: 22 % of the side. */
  radius: 7,
  /** Paper: the mark's fluke (docs/design.md, "Brand colours"). */
  figure: '#F8F5EF',
} as const;

/** The colour a layer's tone is painted in, for this avatar. */
export function presetAvatarColor(avatar: PresetAvatar, tone: PresetAvatarTone): string {
  return tone === 'figure' ? PRESET_AVATAR_STYLE.figure : tone === 'plate' ? avatar.plate : avatar.accent;
}

const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}Z`;
/** A rounded rectangle; `r` at most half the shorter side. */
const box = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
const paper = (d: string): PresetAvatarLayer => ({ d, fill: 'figure' });
const accent = (d: string): PresetAvatarLayer => ({ d, fill: 'accent' });
const cut = (d: string): PresetAvatarLayer => ({ d, fill: 'plate' });

export const PRESET_AVATARS: readonly PresetAvatar[] = [
  // The team assistant every team is given: a spark, in the brand's navy and amber.
  { id: 'assistant', plate: '#1E2F6D', accent: '#E8A33D', layers: [paper('M15 7C15.8 12.6 18.4 15.2 24 16C18.4 16.8 15.8 19.4 15 25C14.2 19.4 11.6 16.8 6 16C11.6 15.2 14.2 12.6 15 7Z'), accent(circle(22.5, 9.5, 2.5))] },
  // Finance: a stack of coins, the top one gold.
  { id: 'finance', plate: '#1F4D3A', accent: '#D9B44A', layers: [paper(box(9.5, 20, 14, 4, 2)), paper(box(11, 15, 14, 4, 2)), accent(box(8, 10, 14, 4, 2))] },
  // Administration: a grid kept in order, one cell picked out.
  { id: 'admin', plate: '#5A3A5E', accent: '#E9B8C8', layers: [paper(box(8.5, 8.5, 6.5, 6.5, 1.5)), paper(box(17, 8.5, 6.5, 6.5, 1.5)), paper(box(8.5, 17, 6.5, 6.5, 1.5)), accent(box(17, 17, 6.5, 6.5, 1.5))] },
  // Human resources: two people, overlapping.
  { id: 'hr', plate: '#7A2E3B', accent: '#F2A07B', layers: [accent(circle(19.5, 16, 5.5)), paper(circle(12.5, 16, 5.5))] },
  // Marketing: a voice that widens as it travels.
  { id: 'marketing', plate: '#A2441F', accent: '#FFD27A', layers: [paper('M8 13L21 8V24L8 19Z'), accent(box(22.5, 10.5, 2.5, 11, 1.25))] },
  // Sales and business: two halves that meet.
  { id: 'sales', plate: '#16324F', accent: '#E07A5F', layers: [paper('M7 15.5A7 7 0 0 1 21 15.5Z'), accent('M11 16.5A7 7 0 0 0 25 16.5Z')] },
  // Engineering: a load on a foundation.
  { id: 'engineer', plate: '#2F3B45', accent: '#F2B134', layers: [accent('M16 8L23.5 18.5H8.5Z'), paper(box(8.5, 19.5, 15, 4.5, 1))] },
  // Product: a thing made, and the idea at its corner.
  { id: 'product', plate: '#3B2F6B', accent: '#8FD1B5', layers: [paper(box(8, 11, 13, 13, 3)), accent(circle(21.5, 10.5, 4))] },
  // Legal: a balance.
  { id: 'legal', plate: '#5C1F2E', accent: '#E3C27A', layers: [paper(box(15, 9, 2, 15, 1)), paper(box(7.5, 11, 17, 2, 1)), accent('M7.5 17A3.5 3.5 0 0 0 14.5 17Z'), accent('M17.5 17A3.5 3.5 0 0 0 24.5 17Z'), paper(box(12, 22.5, 8, 2, 1))] },
  // Design: form, in two shapes.
  { id: 'design', plate: '#0F5257', accent: '#F28E7B', layers: [accent(box(15, 15, 9, 9, 1.5)), paper(circle(13, 13, 5))] },
  // Customer support: someone listening.
  { id: 'support', plate: '#1E5A8C', accent: '#7FD3F0', layers: [paper('M8 18A8 8 0 0 1 24 18H20.5A4.5 4.5 0 0 0 11.5 18Z'), accent(box(7.5, 17, 4.5, 7, 2.25)), accent(box(20, 17, 4.5, 7, 2.25))] },
  // Operations: a network kept running.
  {
    id: 'operations',
    plate: '#4E5320',
    accent: '#E8C547',
    layers: [{ d: 'M16 10.5L10 21.5H22Z', stroke: 'figure', width: 1.4 }, accent(circle(16, 10.5, 3.2)), paper(circle(10, 21.5, 3.2)), paper(circle(22, 21.5, 3.2))],
  },
  // Project management: work laid out in time.
  { id: 'project', plate: '#334E68', accent: '#F6B26B', layers: [paper(box(8, 9, 10, 3.6, 1.8)), accent(box(12, 14.2, 11, 3.6, 1.8)), paper(box(17, 19.4, 7, 3.6, 1.8))] },
  // Training: steps up, and where they lead.
  { id: 'training', plate: '#283C63', accent: '#D9B44A', layers: [paper('M8 24V20H13V16H18V12H24V24Z'), accent(circle(21, 8.5, 2.5))] },
  // Software development: an opening and a closing.
  { id: 'developer', plate: '#22313F', accent: '#5EE0A0', layers: [paper('M14 8.5L6.5 16L14 23.5L16 21.5L10.5 16L16 10.5Z'), accent('M18 8.5L25.5 16L18 23.5L16 21.5L21.5 16L16 10.5Z')] },
  // Research: a lens on something found.
  { id: 'researcher', plate: '#0E4D64', accent: '#9AD1D4', layers: [paper(circle(16, 16, 8)), cut(circle(17.6, 14.4, 5.2)), accent(circle(19, 13, 2.2))] },
  // Data analysis: a rising measure.
  { id: 'analyst', plate: '#1D3557', accent: '#A8DADC', layers: [paper(box(8.5, 17, 4, 7, 2)), paper(box(14, 12.5, 4, 11.5, 2)), accent(box(19.5, 8, 4, 16, 2))] },
  // Writing: a pen's nib, and a drop of ink.
  {
    id: 'writer',
    plate: '#6B4226',
    accent: '#E9C46A',
    layers: [paper('M15 7L21 15.5L15 25L9 15.5Z'), cut(circle(15, 15.5, 1.6)), { d: 'M15 17.5V23.5', stroke: 'plate', width: 1 }, accent(circle(22.5, 9.5, 2.2))],
  },
];

/** The id a preset stores: lowercase letters, digits and hyphens, as the server accepts it. */
export const PRESET_AVATAR_ID = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * The avatar a preset shows: the one it chose when this client knows it,
 * otherwise one picked from `seed` (the preset's name), the same on every client.
 */
export function presetAvatar(chosen: string | null | undefined, seed: string): PresetAvatar {
  const known = chosen ? PRESET_AVATARS.find((avatar) => avatar.id === chosen) : undefined;
  if (known) return known;
  // FNV-1a over the UTF-16 code units: stable across engines, and spread enough for a short id.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return PRESET_AVATARS[hash % PRESET_AVATARS.length]!;
}
