/**
 * What changes between two versions of a team resource, field by field, for
 * the review and history pages (components/team/config-diff.tsx draws it). A
 * resource is its name and its kind's data; the fields compared are the name
 * and every key of the data, in a fixed order for the kinds the console knows
 * and then any others, so a field a newer server adds still shows.
 */

export interface ResourceFields {
  name: string;
  data: Record<string, unknown>;
}

export interface FieldChange {
  key: string;
  before: string;
  after: string;
  /** Long or multi-line on either side: shown as two blocks rather than one line. */
  long: boolean;
}

/** The order the fields are read in: who the resource is, what it calls, then how it behaves. */
const ORDER = [
  'name',
  'description',
  'inheritModel',
  'modelConfigId',
  'provider',
  'model',
  'package',
  'version',
  'sha256',
  'artifactId',
  'requiredTools',
  'optionalTools',
  'pluginDependencies',
  'tools',
  'outputDescription',
  'instructions',
  'systemPrompt',
];

const LONG = 80;

/**
 * One value as a reader reads it: nothing as an empty string, a list as its
 * items, a team resource's id as its name where `names` knows it, and a plugin
 * dependency as `name@version`.
 */
export function readValue(value: unknown, names: ReadonlyMap<string, string>): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return names.get(value) ?? value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'pluginConfigId' in item) {
          const dep = item as { pluginConfigId: string; version?: string };
          return `${names.get(dep.pluginConfigId) ?? dep.pluginConfigId}${dep.version ? `@${dep.version}` : ''}`;
        }
        return readValue(item, names);
      })
      .filter(Boolean)
      .join(', ');
  }
  return JSON.stringify(value);
}

/**
 * The fields that differ from `before` to `after`, in reading order. With no
 * `before` (a resource that does not exist yet), every field `after` sets.
 */
export function diffResource(before: ResourceFields | null, after: ResourceFields, names: ReadonlyMap<string, string> = new Map()): FieldChange[] {
  const keys = new Set(['name', ...Object.keys(before?.data ?? {}), ...Object.keys(after.data)]);
  const ordered = [...ORDER.filter((k) => keys.has(k)), ...[...keys].filter((k) => !ORDER.includes(k)).sort()];
  const pick = (r: ResourceFields | null, key: string) => (r === null ? undefined : key === 'name' ? r.name : r.data[key]);
  const changes: FieldChange[] = [];
  for (const key of ordered) {
    const a = readValue(pick(before, key), names);
    const b = readValue(pick(after, key), names);
    if (a === b) continue;
    changes.push({ key, before: a, after: b, long: a.length > LONG || b.length > LONG || a.includes('\n') || b.includes('\n') });
  }
  return changes;
}
