/**
 * What an admin starts a preset from, and the DSH tools a preset can ask for.
 *
 * A template is copied into the team when it is used and is the team's own
 * from then on: improving a template here never changes a preset a team made
 * from it. Its words (name, persona and method, deliverable) are user-facing,
 * so they live in the messages as `team.templates.<id>.*` and are written into
 * the preset in the admin's language at the time. Its shape is here.
 *
 * Each template is a persona with a method, a tool chain and a deliverable,
 * after the "expert" idea in WorkBuddy, and covers one of the three things
 * teams most often hand to AI beyond code: writing, data and research.
 */

export interface PresetTemplate {
  id: 'writer' | 'analyst' | 'researcher';
  requiredTools: string[];
  optionalTools: string[];
}

export const PRESET_TEMPLATES: readonly PresetTemplate[] = [
  { id: 'writer', requiredTools: ['read', 'write', 'edit'], optionalTools: ['web_search', 'web_fetch', 'ask_user_question'] },
  { id: 'analyst', requiredTools: ['read', 'bash', 'write'], optionalTools: ['glob', 'ask_user_question'] },
  { id: 'researcher', requiredTools: ['web_search', 'web_fetch', 'write'], optionalTools: ['read', 'ask_user_question'] },
];

/**
 * The tools DSH registers under these names (DSH 0.2.2: `dsh-tool-fs`,
 * `-fs-search`, `-bash`, `-web`, `-todo`, `-ask-user`, `-skill`). A preset may
 * name others, such as a plugin's; the editor keeps those as they are. Each
 * one's description is `team.tools.<name>`.
 */
export const DSH_TOOLS = [
  'read',
  'write',
  'edit',
  'apply_patch',
  'glob',
  'grep',
  'bash',
  'web_search',
  'web_fetch',
  'todo_write',
  'ask_user_question',
  'skill',
] as const;
