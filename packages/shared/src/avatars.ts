/**
 * The preset avatars: one vector library the web console and the phone app
 * both draw, so a preset looks the same wherever a member meets it.
 *
 * An avatar is a glyph in paper on the navy plate the mark sits on (navy says
 * "this is the team's", docs/design.md), drawn as stroked paths on a 32-unit
 * square: the plate is the whole square with the logo's corner, the glyph keeps
 * inside 8–24. A client draws the plate, then each path with no fill, the
 * stroke width given here, round caps and round joins; a dot is a path of
 * length zero, which a round cap draws as a disc. Nothing here knows the DOM or
 * React Native.
 *
 * A preset stores the avatar's id (`PresetData.avatar`). The id is the stored
 * contract: an avatar may be redrawn freely, but an id once published is never
 * renamed or reused. The console's editor always stores one; a preset with
 * none (written before avatars, imported from a file, or a DSH's own) or with
 * one this client does not know gets one picked from its name, the one thing
 * every surface shows of it, so the console and the phone draw the same.
 */

export interface PresetAvatar {
  id: string;
  /** Path data on the 32-unit square, each stroked with `PRESET_AVATAR_STYLE`. */
  paths: readonly string[];
}

/** The square every avatar is drawn on, and how its plate and glyph are painted. */
export const PRESET_AVATAR_STYLE = {
  size: 32,
  /** The logo's corner: 22 % of the side. */
  radius: 7,
  /** Navy: the brand plate (docs/design.md, "Brand colours"). */
  plate: '#1E2F6D',
  /** Paper: the mark's fluke. */
  ink: '#F8F5EF',
  strokeWidth: 2,
} as const;

const dot = (x: number, y: number) => `M${x} ${y}h0`;

export const PRESET_AVATARS: readonly PresetAvatar[] = [
  // Office roles first: what a team most often names a preset after.
  {
    id: 'finance',
    paths: ['M11 8H21A1.5 1.5 0 0 1 22.5 9.5V22.5A1.5 1.5 0 0 1 21 24H11A1.5 1.5 0 0 1 9.5 22.5V9.5A1.5 1.5 0 0 1 11 8Z', 'M13 11.5H19', dot(13, 16), dot(16, 16), dot(19, 16), dot(13, 20), dot(16, 20), dot(19, 20)],
  },
  {
    id: 'admin',
    paths: ['M12 9.5H11A1.5 1.5 0 0 0 9.5 11V22.5A1.5 1.5 0 0 0 11 24H21A1.5 1.5 0 0 0 22.5 22.5V11A1.5 1.5 0 0 0 21 9.5H20', 'M13.5 8H18.5V11H13.5Z', 'M13 15.5H19', 'M13 19.5H17'],
  },
  {
    id: 'hr',
    paths: ['M16 12.5A2.5 2.5 0 1 1 11 12.5A2.5 2.5 0 1 1 16 12.5Z', 'M8.5 23C8.5 19.5 10.5 17.5 13.5 17.5C16.5 17.5 18.5 19.5 18.5 23', 'M19 10A2.5 2.5 0 0 1 19 15', 'M20.5 17.8C22.4 18.4 23.5 20.2 23.5 23'],
  },
  { id: 'marketing', paths: ['M9 14V18H12L19 22V10L12 14Z', 'M12 18L13.5 23', 'M22 13.5C23 14.5 23 17.5 22 18.5'] },
  {
    id: 'sales',
    paths: ['M9.5 13H22.5A1 1 0 0 1 23.5 14V22A1 1 0 0 1 22.5 23H9.5A1 1 0 0 1 8.5 22V14A1 1 0 0 1 9.5 13Z', 'M13 13V10.5A1.5 1.5 0 0 1 14.5 9H17.5A1.5 1.5 0 0 1 19 10.5V13', 'M8.5 17.5H23.5'],
  },
  { id: 'engineer', paths: ['M8.5 19.5H23.5V22.5H8.5Z', 'M10.5 19.5V17.5A5.5 5.5 0 0 1 14 12.4', 'M18 12.4A5.5 5.5 0 0 1 21.5 17.5V19.5', 'M14 16.5V10.5H18V16.5'] },
  { id: 'product', paths: ['M16 8.5L23 12V20L16 23.5L9 20V12Z', 'M9 12L16 15.5L23 12', 'M16 15.5V23.5'] },
  { id: 'legal', paths: ['M16 9V23', 'M12.5 23H19.5', 'M10 11.5H22', 'M8 17L10 11.5L12 17', 'M8 17C8.5 18.5 11.5 18.5 12 17', 'M20 17L22 11.5L24 17', 'M20 17C20.5 18.5 23.5 18.5 24 17'] },
  {
    id: 'design',
    paths: [
      'M16 8.5A7.5 7.5 0 0 0 16 23.5C17.5 23.5 18 22.5 17.5 21.3C17 20 17.8 19 19 19H21A2.5 2.5 0 0 0 23.5 16.5C23.5 12 20.2 8.5 16 8.5Z',
      dot(12.5, 14),
      dot(15.5, 11.8),
      dot(19.5, 12.8),
      dot(12.5, 18),
    ],
  },
  {
    id: 'support',
    paths: ['M9.5 18V16A6.5 6.5 0 0 1 22.5 16V18', 'M9.5 17H11.5V21H10.5A1 1 0 0 1 9.5 20Z', 'M22.5 17H20.5V21H21.5A1 1 0 0 0 22.5 20Z', 'M20.5 21C20.5 22.5 19.5 23.5 17.5 23.5H16'],
  },
  { id: 'operations', paths: ['M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16Z', 'M20.5 16A4.5 4.5 0 1 1 11.5 16A4.5 4.5 0 1 1 20.5 16Z', dot(16, 16)] },
  {
    id: 'project',
    paths: ['M10 10.5H22A1.5 1.5 0 0 1 23.5 12V22A1.5 1.5 0 0 1 22 23.5H10A1.5 1.5 0 0 1 8.5 22V12A1.5 1.5 0 0 1 10 10.5Z', 'M8.5 15H23.5', 'M12.5 8.5V12', 'M19.5 8.5V12', dot(12.5, 19), dot(16, 19), dot(19.5, 19)],
  },
  { id: 'training', paths: ['M16 9.5L24 13.5L16 17.5L8 13.5Z', 'M11.5 15.5V19.5C11.5 21 13.5 22.5 16 22.5C18.5 22.5 20.5 21 20.5 19.5V15.5', 'M24 13.5V18'] },
  // Then what a preset does.
  { id: 'spark', paths: ['M16 8L17.9 14.1L24 16L17.9 17.9L16 24L14.1 17.9L8 16L14.1 14.1Z'] },
  { id: 'code', paths: ['M12 11L8 16L12 21', 'M20 11L24 16L20 21', 'M17.5 9.5L14.5 22.5'] },
  { id: 'terminal', paths: ['M9 11L14 16L9 21', 'M16 21H23'] },
  { id: 'search', paths: ['M20 14.5A5.5 5.5 0 1 1 9 14.5A5.5 5.5 0 1 1 20 14.5Z', 'M18.5 18.5L23.5 23.5'] },
  { id: 'pen', paths: ['M19.5 8.5L23.5 12.5L13 23H9V19Z', 'M17 11L21 15'] },
  { id: 'shield', paths: ['M16 8L23 10.5V15.5C23 19.5 20 22.5 16 24C12 22.5 9 19.5 9 15.5V10.5Z', 'M13 16L15.2 18.2L19.5 13.8'] },
  { id: 'chart', paths: ['M9 23H23', 'M11.5 19.5V15', 'M16 19.5V9.5', 'M20.5 19.5V12.5'] },
  {
    id: 'bug',
    paths: [
      'M16 12.5C18.8 12.5 20.5 14.8 20.5 17.8C20.5 20.8 18.5 23.5 16 23.5C13.5 23.5 11.5 20.8 11.5 17.8C11.5 14.8 13.2 12.5 16 12.5Z',
      'M13.5 12.5C13.5 10.6 14.5 9 16 9C17.5 9 18.5 10.6 18.5 12.5',
      'M16 15.5V23.5',
      'M11.5 17H8.5',
      'M20.5 17H23.5',
      'M12 21L9.5 23',
      'M20 21L22.5 23',
    ],
  },
  { id: 'book', paths: ['M16 11C14 9.5 11.5 9 8.5 9V22C11.5 22 14 22.5 16 24C18 22.5 20.5 22 23.5 22V9C20.5 9 18 9.5 16 11Z', 'M16 11V24'] },
  { id: 'bulb', paths: ['M13 20C13 18 11 17 11 13.5A5 5 0 0 1 21 13.5C21 17 19 18 19 20Z', 'M13.5 23.5H18.5'] },
  { id: 'compass', paths: ['M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16Z', 'M19.5 12.5L17.5 17.5L12.5 19.5L14.5 14.5Z'] },
  { id: 'layers', paths: ['M16 8.5L23.5 12.5L16 16.5L8.5 12.5Z', 'M8.5 16.5L16 20.5L23.5 16.5', 'M8.5 20L16 24L23.5 20'] },
  {
    id: 'chat',
    paths: ['M11 9H21A2 2 0 0 1 23 11V18A2 2 0 0 1 21 20H15L11 23.5V20A2 2 0 0 1 9 18V11A2 2 0 0 1 11 9Z', dot(12.5, 14.5), dot(16, 14.5), dot(19.5, 14.5)],
  },
  { id: 'flask', paths: ['M13.5 8.5H18.5', 'M14.5 8.5V13.5L9.7 21.4A1.4 1.4 0 0 0 10.9 23.5H21.1A1.4 1.4 0 0 0 22.3 21.4L17.5 13.5V8.5', 'M12 19H20'] },
  {
    id: 'globe',
    paths: [
      'M23.5 16A7.5 7.5 0 1 1 8.5 16A7.5 7.5 0 1 1 23.5 16Z',
      'M16 8.5C13.8 10.8 12.7 13.3 12.7 16C12.7 18.7 13.8 21.2 16 23.5C18.2 21.2 19.3 18.7 19.3 16C19.3 13.3 18.2 10.8 16 8.5Z',
      'M8.5 16H23.5',
    ],
  },
  {
    id: 'database',
    paths: [
      'M9 11C9 9.3 12.1 8 16 8C19.9 8 23 9.3 23 11C23 12.7 19.9 14 16 14C12.1 14 9 12.7 9 11Z',
      'M9 11V21C9 22.7 12.1 24 16 24C19.9 24 23 22.7 23 21V11',
      'M9 16C9 17.7 12.1 19 16 19C19.9 19 23 17.7 23 16',
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
