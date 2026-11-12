import 'server-only';

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/**
 * The legal pages a deployment publishes, `/privacy` and `/terms`, rendered
 * from its own Markdown: `LEGAL_DIR` names a directory holding `privacy.md`
 * and `terms.md`, absolute or relative to the repository root. Who is the data
 * controller differs per deployment, so no text ships in this app; with
 * `LEGAL_DIR` unset there are no legal pages and nothing links to them.
 *
 * The pages are static, so the files are read once, during `next build`, when
 * the working directory is this app's; a deployed app's working directory need
 * not be the repository's.
 */
export type LegalDocumentName = 'privacy' | 'terms';

export const LEGAL_PATHS: Record<LegalDocumentName, string> = { privacy: '/privacy', terms: '/terms' };

/** Whether this build published legal pages; `next.config` inlines `LEGAL_DIR`, so a link never outlives its page. */
export function hasLegalPages(): boolean {
  return Boolean(process.env.LEGAL_DIR?.trim());
}

/** The document's Markdown, or null when this deployment publishes none. A named file that is missing fails the build. */
export function legalDocument(name: LegalDocumentName): string | null {
  const dir = process.env.LEGAL_DIR?.trim();
  if (!dir) return null;
  const file = resolve(isAbsolute(dir) ? dir : resolve(/* turbopackIgnore: true */ process.cwd(), '../..', dir), `${name}.md`);
  // Read at build only (the pages are static), so the server output need not carry the directory.
  return readFileSync(/* turbopackIgnore: true */ file, 'utf8');
}
