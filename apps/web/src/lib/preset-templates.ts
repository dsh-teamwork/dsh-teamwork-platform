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
 * after the "expert" idea in WorkBuddy, and covers one of the things teams
 * most often hand to AI beyond code: writing, data, research and presentations.
 */

export interface PresetTemplate {
  id: 'writer' | 'analyst' | 'researcher' | 'presenter';
  /** Its id in the avatar library (`@dsh-teamwork/shared`). */
  avatar: string;
  requiredTools: string[];
  optionalTools: string[];
}

export const PRESET_TEMPLATES: readonly PresetTemplate[] = [
  { id: 'writer', avatar: 'writer', requiredTools: ['read', 'write', 'edit'], optionalTools: ['web_search', 'web_fetch', 'ask_user_question'] },
  { id: 'analyst', avatar: 'analyst', requiredTools: ['read', 'bash', 'write'], optionalTools: ['glob', 'ask_user_question'] },
  // Its method is the plugin's teamwork-research skill. web_search needs a DeepSeek key on the member's DSH, so it is
  // optional: without it the analyst reads primary sources with web_fetch.
  { id: 'researcher', avatar: 'researcher', requiredTools: ['web_fetch', 'write', 'skill', 'teamwork_artifact'], optionalTools: ['web_search', 'read', 'bash', 'ask_user_question'] },
  // Its method is the plugin's teamwork-slides skill; every member's plugin carries both (dsh-teamwork's skills/).
  { id: 'presenter', avatar: 'training', requiredTools: ['read', 'write', 'skill', 'teamwork_artifact'], optionalTools: ['bash', 'web_search', 'web_fetch', 'ask_user_question'] },
];

/**
 * The tools DSH registers under these names (DSH 0.2.2: `dsh-tool-fs`,
 * `-fs-search`, `-bash`, `-web`, `-todo`, `-ask-user`, `-skill`), and the
 * Teamwork plugin's `teamwork_artifact`, which every member has. A preset may name
 * others, such as a plugin's; the editor keeps those as they are. Each one's
 * description is `team.tools.<name>`.
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
  'teamwork_artifact',
  'teamwork_knowledge',
] as const;
