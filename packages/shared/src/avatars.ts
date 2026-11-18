/**
 * The preset avatars: one vector library the web console and the phone app
 * both draw, so a preset looks the same wherever a member meets it.
 *
 * An avatar is a professional, not a tool: a head-and-shoulders figure in
 * paper, faceless, told apart by what the role wears or carries (an
 * engineer's hard hat, counsel's gown and bands, a support agent's headset)
 * and by its own plate and accent colour (docs/design.md, "Preset avatars").
 *
 * Each is drawn on a 32-unit square: the plate is the whole square with the
 * logo's corner, then each layer in order, filled and/or stroked in one of
 * three tones — the figure's paper, the avatar's plate (a cut-out on the
 * figure) or its accent — with round caps and joins. The figure stays clear of
 * the plate's rounded corners, so no client needs a clip. Nothing here knows
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

/** The square every avatar is drawn on, and the paper its figure is drawn in. */
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

// The figure every avatar starts from: a head over shoulders that stop short of the plate's corners.
const HEAD = 'M21 13.5A5 5 0 1 1 11 13.5A5 5 0 1 1 21 13.5Z';
const BODY = 'M7.5 32V28.5C7.5 24.3 11.2 21.2 16 21.2C20.8 21.2 24.5 24.3 24.5 28.5V32Z';
const head: PresetAvatarLayer = { d: HEAD, fill: 'figure' };
const body: PresetAvatarLayer = { d: BODY, fill: 'figure' };
const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}Z`;

// What several roles share.
const glasses: PresetAvatarLayer = { d: `${circle(13.7, 14, 1.5)}${circle(18.3, 14, 1.5)}M15.2 14H16.8`, stroke: 'plate', width: 0.9 };
const lapels: PresetAvatarLayer = { d: 'M12.2 21.9L16 27L19.8 21.9', stroke: 'plate', width: 0.9 };
const tie: PresetAvatarLayer = { d: 'M16 22.2L14.9 23.4L16 29.5L17.1 23.4Z', fill: 'accent' };

export const PRESET_AVATARS: readonly PresetAvatar[] = [
  {
    // The team assistant every team is given: a spark on the chest.
    id: 'assistant',
    plate: '#1E2F6D',
    accent: '#E8A33D',
    layers: [body, head, { d: 'M16 23.3L16.9 25.9L19.5 26.8L16.9 27.7L16 30.3L15.1 27.7L12.5 26.8L15.1 25.9Z', fill: 'accent' }],
  },
  {
    // Finance: glasses, a tie, and the ledger's green.
    id: 'finance',
    plate: '#1F4D3A',
    accent: '#D9B44A',
    layers: [body, head, lapels, tie, glasses],
  },
  {
    // Administration: hair in a bun and a lanyard badge.
    id: 'admin',
    plate: '#5A3A5E',
    accent: '#E9B8C8',
    layers: [
      body,
      head,
      { d: circle(16, 7.6, 2.1), fill: 'accent' },
      { d: 'M11 13C11.6 10.1 13.6 8.6 16 8.6C18.4 8.6 20.4 10.1 21 13C19.2 11.6 17.4 11.1 15.6 11.2C13.8 11.3 12.3 11.9 11 13Z', fill: 'accent' },
      { d: 'M13 21.6L16 26L19 21.6', stroke: 'accent', width: 0.8 },
      { d: 'M14.6 26H17.4V29.4H14.6Z', fill: 'accent' },
    ],
  },
  {
    // Human resources: shoulder-length hair and a heart pin.
    id: 'hr',
    plate: '#7A2E3B',
    accent: '#F2A07B',
    layers: [
      { d: 'M9.6 14.5C9.6 9.4 12.4 7.4 16 7.4C19.6 7.4 22.4 9.4 22.4 14.5V20.4C21 21 19.6 20.6 19 19.6H13C12.4 20.6 11 21 9.6 20.4Z', fill: 'accent' },
      body,
      head,
      { d: 'M11.1 12.4C12 10.2 14 9.2 16.2 9.6C15.2 10.8 13.4 12 11.1 12.4Z', fill: 'accent' },
      { d: 'M19.8 25.6C19.8 24.9 20.9 24.5 21.4 25.3C21.9 24.5 23 24.9 23 25.6C23 26.6 21.4 27.6 21.4 27.6C21.4 27.6 19.8 26.6 19.8 25.6Z', fill: 'accent' },
    ],
  },
  {
    // Marketing: a megaphone raised at the shoulder.
    id: 'marketing',
    plate: '#A2441F',
    accent: '#FFD27A',
    layers: [body, head, { d: 'M20.2 22.4L26 19.6V26.8L20.2 24.6Z', fill: 'accent' }, { d: 'M20.6 23.5H19.2', stroke: 'accent', width: 1.4 }],
  },
  {
    // Sales and business: a suit, a tie and a pocket square.
    id: 'sales',
    plate: '#16324F',
    accent: '#E07A5F',
    layers: [
      body,
      head,
      { d: 'M7.5 32V28.5C7.5 25.4 9.5 22.9 12.4 21.8L16 27L19.6 21.8C22.5 22.9 24.5 25.4 24.5 28.5V32Z', fill: 'plate' },
      { d: 'M7.5 32V28.5C7.5 25.4 9.5 22.9 12.4 21.8L16 27L19.6 21.8C22.5 22.9 24.5 25.4 24.5 28.5V32', stroke: 'figure', width: 0.8 },
      tie,
      { d: 'M19.6 26.4L21.8 25.8L21.6 27.2Z', fill: 'accent' },
    ],
  },
  {
    // Engineering: a hard hat and a vest's reflective stripes.
    id: 'engineer',
    plate: '#2F3B45',
    accent: '#F2B134',
    layers: [
      body,
      head,
      { d: 'M10.4 12.4C10.4 8.6 12.9 6.6 16 6.6C19.1 6.6 21.6 8.6 21.6 12.4Z', fill: 'accent' },
      { d: 'M9 12.2H23V13.8H9Z', fill: 'accent' },
      { d: 'M16 7V10.8', stroke: 'plate', width: 0.9 },
      { d: 'M12.6 21.8V32M19.4 21.8V32', stroke: 'accent', width: 1.4 },
    ],
  },
  {
    // Product: a turtleneck, glasses and a sticky note.
    id: 'product',
    plate: '#3B2F6B',
    accent: '#8FD1B5',
    layers: [
      body,
      head,
      { d: 'M13.2 19.2H18.8V22.6H13.2Z', fill: 'figure' },
      { d: 'M13.2 20.4H18.8M13.2 21.6H18.8', stroke: 'plate', width: 0.5 },
      { d: 'M18.6 24.6H23L23 28.2L21.8 29H18.6Z', fill: 'accent' },
      glasses,
    ],
  },
  {
    // Legal: counsel's wig, gown and white bands.
    id: 'legal',
    plate: '#5C1F2E',
    accent: '#1A1A22',
    layers: [
      { d: BODY, fill: 'accent' },
      head,
      { d: 'M12.4 21.8L16 26L19.6 21.8', stroke: 'figure', width: 0.8 },
      { d: 'M15 22.6H15.9V26.6H15ZM16.1 22.6H17V26.6H16.1Z', fill: 'figure' },
      {
        d: 'M9.2 13.4C9.6 9 12.4 7.4 16 7.4C19.6 7.4 22.4 9 22.8 13.4V16.6C22.2 17.2 21.6 17 21.2 16.4V12.4C19 11.2 13 11.2 10.8 12.4V16.4C10.4 17 9.8 17.2 9.2 16.6Z',
        fill: 'figure',
      },
      { d: 'M9.2 14.4H10.8M9.2 15.6H10.8M21.2 14.4H22.8M21.2 15.6H22.8', stroke: 'plate', width: 0.4 },
    ],
  },
  {
    // Design: a beret and a pencil in the pocket.
    id: 'design',
    plate: '#0F5257',
    accent: '#F28E7B',
    layers: [
      body,
      head,
      { d: 'M10 11C10.2 8 12.8 6.6 16.4 6.8C20.2 7 22.6 8.4 22.2 11C20.2 10.2 13 10.2 10 11Z', fill: 'accent' },
      { d: 'M16.6 6.8V5.6', stroke: 'accent', width: 1.2 },
      { d: 'M20 22.6L21.6 29', stroke: 'accent', width: 1.4 },
    ],
  },
  {
    // Customer support: a headset with its microphone.
    id: 'support',
    plate: '#1E5A8C',
    accent: '#7FD3F0',
    layers: [
      body,
      head,
      { d: 'M10.2 14A5.8 5.8 0 0 1 21.8 14', stroke: 'accent', width: 1.3 },
      { d: 'M9.2 12.6H11.4V16.6H9.2ZM20.6 12.6H22.8V16.6H20.6Z', fill: 'accent' },
      { d: 'M10.4 16.6C10.4 18.6 12 19.6 14.2 19.6', stroke: 'accent', width: 1 },
      { d: circle(14.6, 19.6, 0.8), fill: 'accent' },
    ],
  },
  {
    // Operations: a cap and a radio.
    id: 'operations',
    plate: '#4E5320',
    accent: '#E8C547',
    layers: [
      body,
      head,
      { d: 'M10.8 12.2C10.8 9 13 7.4 16 7.4C19 7.4 21.2 9 21.2 12.2Z', fill: 'accent' },
      { d: 'M16 12.2H24', stroke: 'accent', width: 1.4 },
      { d: 'M19.6 24H22.6V29.6H19.6Z', fill: 'accent' },
      { d: 'M21.8 24V21.6', stroke: 'accent', width: 0.8 },
    ],
  },
  {
    // Project management: a clipboard held to the chest.
    id: 'project',
    plate: '#334E68',
    accent: '#F6B26B',
    layers: [
      body,
      head,
      { d: 'M12.6 24.4H19.4V31.4H12.6Z', fill: 'accent' },
      { d: 'M14.6 23.6H17.4V25.2H14.6Z', fill: 'plate' },
      { d: 'M14 27H18M14 29H16.6', stroke: 'plate', width: 0.8 },
    ],
  },
  {
    // Training: a mortarboard and its tassel.
    id: 'training',
    plate: '#283C63',
    accent: '#D9B44A',
    layers: [
      body,
      head,
      { d: 'M16 5.4L24 8.8L16 12.2L8 8.8Z', fill: 'plate' },
      { d: 'M16 5.4L24 8.8L16 12.2L8 8.8Z', stroke: 'figure', width: 0.7 },
      { d: 'M11.4 10.4V12.4C13 13.2 19 13.2 20.6 12.4V10.4', fill: 'plate' },
      { d: 'M24 8.8V13', stroke: 'accent', width: 0.9 },
      { d: circle(24, 13.4, 0.7), fill: 'accent' },
    ],
  },
  {
    // Software development: headphones and a hoodie's cords.
    id: 'developer',
    plate: '#22313F',
    accent: '#5EE0A0',
    layers: [
      body,
      { d: 'M11.6 21.8C12 19.8 13.6 18.8 16 18.8C18.4 18.8 20 19.8 20.4 21.8', stroke: 'plate', width: 0.8 },
      head,
      { d: 'M10 13.6A6 6 0 0 1 22 13.6', stroke: 'accent', width: 1.4 },
      { d: 'M8.8 12.8H11.4V17.2H8.8ZM20.6 12.8H23.2V17.2H20.6Z', fill: 'accent' },
      { d: 'M14.6 22.4V26.4M17.4 22.4V26.4', stroke: 'plate', width: 0.7 },
    ],
  },
  {
    // Research: a lab coat and goggles on the brow.
    id: 'researcher',
    plate: '#0E4D64',
    accent: '#9AD1D4',
    layers: [
      body,
      head,
      { d: 'M16 21.4V32M12.4 21.9L16 25.4L19.6 21.9', stroke: 'plate', width: 0.8 },
      { d: 'M18.8 26.2H21.8', stroke: 'plate', width: 0.8 },
      { d: 'M11 9.6H21V12.4H11Z', fill: 'accent' },
      { d: 'M16 9.6V12.4', stroke: 'plate', width: 0.6 },
    ],
  },
  {
    // Data analysis: glasses and a chart on the badge.
    id: 'analyst',
    plate: '#1D3557',
    accent: '#A8DADC',
    layers: [body, head, glasses, { d: 'M18.4 24.4H23.4V29.4H18.4Z', fill: 'accent' }, { d: 'M19.6 28.4V27M20.9 28.4V25.6M22.2 28.4V26.4', stroke: 'plate', width: 0.7 }],
  },
  {
    // Writing: a scarf and a fountain pen.
    id: 'writer',
    plate: '#6B4226',
    accent: '#E9C46A',
    layers: [
      body,
      head,
      { d: 'M11.6 20.6C13 21.8 19 21.8 20.4 20.6L20.8 22.4C19 23.8 13 23.8 11.2 22.4Z', fill: 'accent' },
      { d: 'M17.6 22.8L19.2 28.6L17.4 28.2Z', fill: 'accent' },
      { d: 'M21 24L23.2 30.6', stroke: 'plate', width: 1.2 },
    ],
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
