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

/**
 * Every extension an attachment may have (docs/tech/knowledge.md,
 * "Attachments"), as the server allows them: a `[[name.ext]]` with one of
 * these names a file of the document, any other names a document.
 */
export const ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'pdf', 'txt', 'csv', 'json', 'docx', 'xlsx', 'pptx', 'zip']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);

/** The largest attachment the server stores, 20 MiB. */
export const MAX_ATTACHMENT = 20 << 20;

const extension = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** Whether a link's target names an attachment: an allowed extension, in any case. */
export function isAttachmentName(name: string): boolean {
  return ATTACHMENT_EXTENSIONS.has(extension(name.trim()));
}

/** Whether an attachment's name is an image's, which `![[name]]` draws. */
export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extension(name.trim()));
}

/** The attachments a text names, `![[name]]` or `[[name]]`, each once, in the order they first appear. */
export function attachmentNamesIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(WIKILINK)) {
    const { title } = parseWikiTarget(m[1]);
    if (isAttachmentName(title)) names.add(title);
  }
  return [...names];
}

/** Where a browser reads an attachment, on the session cookie. */
export function attachmentUrl(teamId: string, documentId: string, name: string): string {
  return `/api/teams/${encodeURIComponent(teamId)}/knowledge/documents/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(name)}`;
}

/**
 * A file's name made one a link can hold: trimmed, and each character a
 * `[[link]]` or a path cannot hold (`[ ] | # ^ / \` and control characters)
 * replaced by a hyphen.
 */
export function attachmentNameOf(fileName: string): string {
  return fileName.replace(/[[\]|#^/\\\u0000-\u001f\u007f]/g, '-').trim();
}

/** The name of a pasted image, as Obsidian names one: `Pasted image 20261124153012.png`. */
export function pastedName(at: Date, ext: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Pasted image ${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.${ext}`;
}

/** A name for a file whose name is taken: `diagram (2).png`, or the next number no name in `taken` has. */
export function suggestAttachmentName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  used.add(name);
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/ \(\d+\)$/, '');
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!used.has(next)) return next;
  }
}

/**
 * A callout's first line, as Obsidian writes it inside a quote:
 * `> [!warning] Title`, with `-` after the kind for one folded until opened
 * and `+` for one open that may be folded. The kind is any word; the ones
 * below have a colour and a name of their own, and any other reads as a note.
 */
export const CALLOUT = /^\[!([A-Za-z][\w-]*)\]([+-]?)(?:[ \t]+|$)/;

/** The kinds the editor offers, each with a name in the console's messages. */
export const CALLOUT_KINDS = ['note', 'info', 'tip', 'success', 'question', 'warning', 'danger', 'bug', 'example', 'quote'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** How a callout folds: never, open until folded, or folded until opened. */
export type CalloutFold = '' | '+' | '-';

const FAMILIES: Record<string, 'brand' | 'success' | 'signal' | 'destructive' | 'muted'> = {
  note: 'brand', info: 'brand', todo: 'brand', abstract: 'brand', summary: 'brand', tldr: 'brand',
  tip: 'success', hint: 'success', important: 'success', success: 'success', check: 'success', done: 'success',
  question: 'signal', help: 'signal', faq: 'signal', warning: 'signal', caution: 'signal', attention: 'signal',
  danger: 'destructive', error: 'destructive', failure: 'destructive', fail: 'destructive', missing: 'destructive', bug: 'destructive',
  example: 'muted', quote: 'muted', cite: 'muted',
};

/** The colour a callout of a kind is drawn in, Obsidian's aliases included; an unknown kind is a note's. */
export function calloutFamily(kind: string): string {
  return FAMILIES[kind.toLowerCase()] ?? 'brand';
}

/** Whether a kind is one the editor names, by any case. */
export function knownCalloutKind(kind: string): CalloutKind | null {
  const lower = kind.toLowerCase();
  return (CALLOUT_KINDS as readonly string[]).includes(lower) ? (lower as CalloutKind) : null;
}

/** A code block of this language is drawn as a diagram, its source still the text. */
export const DIAGRAM_LANGUAGE = 'mermaid';

/**
 * A template's text as a new document starts with it: `{{title}}` becomes the
 * new document's title and `{{date}}` today's date (`2026-11-24`), as
 * Obsidian's core templates fill them; any other text is kept as written.
 */
export function fillTemplate(text: string, title: string, today: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  return text.replace(/\{\{\s*(title|date)\s*\}\}/g, (_m, key: string) => (key === 'title' ? title : date));
}

/** What `![[artifact:{id}]]` starts with: an embedded artifact's card, which links no document (server/internal/knowledge, ArtifactEmbed). */
export const ARTIFACT_EMBED = 'artifact:';

/**
 * A line of a document as a list shows it beside its title: a mention as
 * `@` and the name `nameOf` gives its member (the one it was written with for
 * someone no longer known), and a `[[link]]` or `![[embed]]` as the words it
 * shows.
 */
export function readableLine(line: string, nameOf: (id: string) => string | null): string {
  return line
    .replace(/@\[([^\]\n]*)\]\(([\w-]+)\)/g, (_m, name: string, id: string) => `@${nameOf(id) ?? name}`)
    .replace(/!?\[\[([^[\]\n]+)\]\]/g, (_m, raw: string) => parseWikiTarget(raw).label || raw);
}
