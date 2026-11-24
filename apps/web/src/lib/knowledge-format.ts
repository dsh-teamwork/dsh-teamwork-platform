/**
 * The plain-text conventions of a knowledge document (docs/tech/knowledge.md,
 * "Format") that the console handles outside the editor: front matter, kept
 * out of the editor and put back on save; `[[Document]]` and
 * `[[Document#Heading]]` links; the slug a heading is cited by; and the save
 * that first records Milkdown's one-time normalisation as a version of its own.
 */

/** YAML front matter at the very start of a file, with the blank lines after it. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)(?:\r?\n)*/;

/** A document's front matter, exactly as written (empty when it has none), and the body the editor opens. */
export function splitFrontMatter(text: string): { frontMatter: string; body: string } {
  const match = FRONT_MATTER.exec(text);
  return match ? { frontMatter: match[0], body: text.slice(match[0].length) } : { frontMatter: '', body: text };
}

/** The file again from its front matter and the editor's body; the inverse of splitFrontMatter. */
export function joinFrontMatter(frontMatter: string, body: string): string {
  return frontMatter + body;
}

/** A `[[…]]` link in text, as Obsidian writes it: no brackets or line break inside. */
export const WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/** What a `[[…]]` link names: a document title, a heading in it, and the words shown in its place (`[[Title#Heading|shown]]`). */
export interface WikiTarget {
  title: string;
  heading: string;
  label: string;
}

export function parseWikiTarget(raw: string): WikiTarget {
  const bar = raw.indexOf('|');
  const target = bar === -1 ? raw : raw.slice(0, bar);
  const alias = bar === -1 ? '' : raw.slice(bar + 1).trim();
  const hash = target.indexOf('#');
  const title = (hash === -1 ? target : target.slice(0, hash)).trim();
  const heading = hash === -1 ? '' : target.slice(hash + 1).trim();
  return { title, heading, label: alias || (heading ? (title ? `${title} › ${heading}` : heading) : title) };
}

/**
 * A heading's anchor, the `#anchor` of a citation
 * (`knowledge:{documentId}@{version}#{anchor}`): the heading's text in lower
 * case with each run of spaces one hyphen, as the plugin writes it. Letters
 * of every script are kept, so a Chinese heading has an anchor of its own.
 */
export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * The note of the version that records the editor's normalisation of a
 * document written elsewhere. Stored in English, as every note an agent reads
 * is; the console words it in the reader's language.
 */
export const FORMATTING_NOTE = 'Formatting';

/** One version a save posts, each on top of the one before it. */
export interface PlannedVersion {
  text: string;
  note: string;
}

/**
 * The versions an editor's save posts. `stored` is the text the editor opened,
 * `normalised` the same text after loading it into the editor and serialising
 * it with no edit, and `edited` what the person saved. When the editor would
 * rewrite the stored text anyway, the rewrite is its own version, noted as
 * formatting, so the person's version shows only what they changed.
 */
export function planSave(stored: string, normalised: string, edited: string, note: string): PlannedVersion[] {
  if (edited === stored) return [];
  if (normalised === stored) return [{ text: edited, note }];
  // Nothing changed but the syntax: that is the formatting version alone.
  if (edited === normalised) return [{ text: normalised, note: FORMATTING_NOTE }];
  return [
    { text: normalised, note: FORMATTING_NOTE },
    { text: edited, note },
  ];
}
