/**
 * Syntax colours for a file in a session's sidebar, as DSH draws code (`CodeBlock`, Shiki): GitHub's light and dark
 * themes, the one in force picked by CSS (`.shiki-token` in globals.css). Shiki and each language load only when a file
 * of that language is opened, on the JavaScript regex engine, so no WebAssembly is fetched. The languages are a fixed
 * list rather than Shiki's every grammar: the server embeds the console's build, and each grammar is a file in it.
 */

import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki';

/** Past this a file stays plain: highlighting it would hold the page up. */
const MAX_BYTES = 200 * 1024;

type Grammar = () => Promise<{ default: LanguageRegistration[] }>;

const GRAMMARS: Record<string, Grammar> = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  proto: () => import('shiki/langs/proto.mjs'),
  r: () => import('shiki/langs/r.mjs'),
};

/** A file's extension, or its whole name, to the grammar that reads it. */
const NAMES: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript', jsx: 'jsx', tsx: 'tsx',
  json: 'json', jsonc: 'jsonc', json5: 'jsonc', css: 'css', scss: 'scss', sass: 'scss', less: 'less', html: 'html', htm: 'html',
  xml: 'xml', svg: 'xml', plist: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini',
  py: 'python', pyi: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', lua: 'lua',
  dart: 'dart', scala: 'scala', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', fish: 'shellscript',
  ps1: 'powershell', sql: 'sql', graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff', proto: 'proto', r: 'r',
  dockerfile: 'docker', makefile: 'make', mk: 'make',
};

let loading: Promise<HighlighterCore> | null = null;

function load() {
  loading ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ]);
    return createHighlighterCore({ engine: createJavaScriptRegexEngine(), themes: [light.default, dark.default], langs: [] });
  })();
  return loading;
}

/** The grammar `path` is read in, by its name or its extension, or null for none. */
export function languageOf(path: string): string | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  return NAMES[name] ?? (dot < 0 ? null : NAMES[name.slice(dot + 1)] ?? null);
}

/** `code`'s tokens, line by line, in both themes; null when it is too large or its language is not on the list. */
export async function highlight(code: string, path: string): Promise<{ language: string; lines: ThemedToken[][] } | null> {
  const language = languageOf(path);
  if (code.length > MAX_BYTES || !language) return null;
  const highlighter = await load();
  if (!highlighter.getLoadedLanguages().includes(language)) await highlighter.loadLanguage((await GRAMMARS[language]!()).default);
  const { tokens } = highlighter.codeToTokens(code, { lang: language, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
  return { language, lines: tokens };
}
