import type { Root } from 'hast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { gfm } from 'micromark-extension-gfm';

export type { Element, ElementContent } from 'hast';

/** Parse GFM into semantic nodes for the native view, dropping raw HTML. */
export function parseMarkdown(text: string): Root {
  const tree = toHast(fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
  return tree as Root; // The mdast root always maps to a hast root.
}
