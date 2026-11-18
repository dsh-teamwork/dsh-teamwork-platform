/**
 * The Markdown an agent writes, read into blocks a phone can draw: headings,
 * paragraphs, lists, quotes and fenced code, with bold, italic, inline code and
 * links inside them. Deliberately small: what an agent's reply uses, and
 * nothing a reply could use to reach outside its bubble (no images, no HTML).
 * A reply that is still streaming parses the same way, an unclosed fence
 * included, so the screen never jumps when the closing line arrives.
 */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'rule' };

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** An http(s) link's address; other schemes stay plain text. */
  href?: string;
}

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i]!); i++) body.push(lines[i]!);
      blocks.push({ type: 'code', language: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, text: heading[2]!.trim() });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const previous = blocks.at(-1);
      const item = (bullet ? bullet[1] : numbered![2])!;
      if (previous?.type === 'list' && previous.ordered === ordered) previous.items.push(item);
      else blocks.push({ type: 'list', ordered, start: ordered ? Number(numbered![1]) : 1, items: [item] });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const previous = blocks.at(-1);
      if (previous?.type === 'quote') previous.text += `\n${quote[1]}`;
      else blocks.push({ type: 'quote', text: quote[1]! });
      continue;
    }
    // A line that continues a list item rather than starting a paragraph.
    const previous = blocks.at(-1);
    if (!paragraph.length && previous?.type === 'list' && /^\s{2,}\S/.test(line)) {
      previous.items[previous.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// Emphasis is asterisks only: an agent's text is full of snake_case names, which underscores would italicise.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\([^)\s]+\))/;

/** One block's text as styled runs. Unbalanced markers stay as they are. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      push(spans, { text: rest });
      break;
    }
    if (match.index > 0) push(spans, { text: rest.slice(0, match.index) });
    const [token] = match;
    if (match[1]) push(spans, { text: token.slice(1, -1), code: true });
    else if (match[2]) for (const inner of parseInline(token.slice(2, -2))) push(spans, { ...inner, bold: true });
    else if (match[3]) for (const inner of parseInline(token.slice(1, -1))) push(spans, { ...inner, italic: true });
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      if (/^https?:\/\//i.test(href!)) push(spans, { text: label!, href });
      else push(spans, { text: label! });
    }
    rest = rest.slice(match.index + token.length);
  }
  return spans;
}

/** Joins a run onto the one before it when they look the same, so plain text is one span. */
function push(spans: Span[], span: Span) {
  const last = spans.at(-1);
  if (last && !last.code && !span.code && !last.href && !span.href && !!last.bold === !!span.bold && !!last.italic === !!span.italic) {
    last.text += span.text;
  } else {
    spans.push(span);
  }
}
