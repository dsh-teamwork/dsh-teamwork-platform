#!/usr/bin/env node
/**
 * Fail if CJK text appears anywhere a developer reads.
 *
 * The rule is in CLAUDE.md: English in the repo, any language in the product.
 * A rule nobody can see being broken gets broken, and this one breaks silently —
 * a Chinese comment compiles, passes tests, and ships. So it is checked, not
 * asked for.
 *
 * The exemptions below are the product itself: locale files and store listings
 * are Chinese *because that is what the user reads*. Everything else is source.
 *
 *   pnpm lint:lang
 *
 * Adding an exemption is allowed. Adding one without a `why` is not — the
 * assertion at the bottom of ALLOWED enforces that, because an unexplained
 * entry here is how the rule quietly dies.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * Han, the kana ranges, and Hangul.
 *
 * Each range was added because the one before it was not enough: a Han-only
 * test lets ja.json through, and Han-plus-kana lets ko.json through. The app
 * ships all three scripts, so a rule that cannot see one of them is a rule not
 * being enforced for a language somebody reads the product in.
 */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힣ᄀ-ᇿㄱ-ㆎ]/;

const ALLOWED = [
  {
    // This file necessarily contains CJK — the range endpoints of the regex
    // above — so it cannot pass its own check.
    match: (f) => f === 'scripts/check-language.mjs',
    why: 'The scanner has to spell out the characters it scans for, so it cannot pass its own check.',
  },
  {
    match: (f) => /^(?:[^/]+\/)?apps\/(?:[^/]+\/src\/messages|mobile\/lib\/i18n\/locales)\/.+\.json$/.test(f),
    why: 'Locale files: the product speaking to its user in the language that user chose. Keys and structure are English.',
  },
  {
    match: (f) => /^(?:[^/]+\/)?server\/(?:[^/]+\/)*messages\/[^/]+\.json$/.test(f),
    why: 'Locale files the Go server embeds, such as what a notification says: the same data as the apps\' messages, beside the package that sends it.',
  },
  {
    match: (f) => f === 'packages/shared/src/locales.ts',
    why: 'Endonyms. A language picker that names languages in a language you cannot read is useless, so each language\'s own name for itself is the correct string.',
  },
];

/** Nothing to read as text. */
const BINARY = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.mp4', '.wav', '.zip', '.pdf',
]);

for (const rule of ALLOWED) {
  if (!rule.why || rule.why.length < 20) {
    console.error('An entry in ALLOWED has no usable `why`. Say what makes it product content.');
    process.exit(2);
  }
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !BINARY.has(extname(f).toLowerCase()));

const problems = [];

for (const file of files) {
  if (ALLOWED.some((rule) => rule.match(file))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable or vanished between ls-files and here
  }
  if (!CJK.test(text)) continue;
  text.split('\n').forEach((line, i) => {
    if (CJK.test(line)) problems.push({ file, line: i + 1, text: line.trim().slice(0, 100) });
  });
}

if (problems.length === 0) {
  console.log(`Language OK — ${files.length} tracked files, no CJK outside the product.`);
  process.exit(0);
}

const byFile = new Map();
for (const p of problems) byFile.set(p.file, (byFile.get(p.file) ?? 0) + 1);

console.error(`CJK found in ${byFile.size} file(s) that should be English:\n`);
for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${file}  (${count} line${count === 1 ? '' : 's'})`);
}
console.error(`\nFirst few:`);
for (const p of problems.slice(0, 15)) {
  console.error(`  ${p.file}:${p.line}  ${p.text}`);
}
console.error(
  `\nSee CLAUDE.md → "Language". If one of these is genuinely product content ` +
    `(something a user reads), add it to ALLOWED in this file with a \`why\`.`,
);
process.exit(1);
