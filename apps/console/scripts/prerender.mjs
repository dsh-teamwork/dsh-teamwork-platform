// Renders the public pages (src/public/) to static HTML in dist/public/, after
// `vite build` and before embed.mjs: home in each locale and sign-in state,
// privacy and terms when LEGAL_DIR is set, and the share card. The Go server
// embeds them and picks one per request (server/internal/web).
//
// LEGAL_DIR names a directory holding privacy.md and terms.md, absolute or
// relative to the repository root. Who is the data controller differs per
// deployment, so no text ships in this app; with LEGAL_DIR unset there are no
// legal pages and nothing links to them. A named file that is missing fails
// the build.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import satori from 'satori';
import sharp from 'sharp';
import { build } from 'vite';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(app, '..', '..');
const dist = join(app, 'dist');
const out = join(dist, 'public');

// What the console's build wrote: its stylesheet, and the public pages' script.
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));
const cssOf = (key, seen = new Set()) => {
  if (seen.has(key)) return [];
  seen.add(key);
  const chunk = manifest[key];
  return [...(chunk.css ?? []), ...(chunk.imports ?? []).flatMap((k) => cssOf(k, seen))];
};
const assets = {
  css: [...new Set(cssOf('index.html'))].map((file) => `/${file}`),
  script: `/${manifest['src/public/client.ts'].file}`,
};
if (assets.css.length === 0) throw new Error('the console build wrote no stylesheet');
// Nothing serves the manifest; it is the build's note to this script.
rmSync(join(dist, '.vite'), { recursive: true, force: true });

// The pages' renderer, built for Node into a scratch directory.
const ssr = join(app, 'node_modules', '.prerender');
await build({
  configFile: false,
  root: app,
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@': join(app, 'src') } },
  build: { ssr: join(app, 'src', 'public', 'render.tsx'), outDir: ssr, emptyOutDir: true },
});
const { renderPages } = await import(pathToFileURL(join(ssr, 'render.js')).href);

const legalDir = process.env.LEGAL_DIR?.trim();
const legalFile = (name) => readFileSync(resolve(isAbsolute(legalDir) ? legalDir : join(repo, legalDir), `${name}.md`), 'utf8');
const legal = legalDir ? { privacy: legalFile('privacy'), terms: legalFile('terms') } : null;

mkdirSync(out, { recursive: true });
for (const [name, html] of Object.entries(renderPages(assets, legal))) writeFileSync(join(out, name), html);
rmSync(ssr, { recursive: true, force: true });

// The share card, 1200×630: the logo as `pnpm assets:icons` exports it
// (docs/design.md, "Exports"), and Onest from assets/fonts (latin subset, from
// @fontsource/onest 5.3.1; OFL, licence beside the files): bold for the name,
// regular for the tagline. `.woff`, because satori reads no `.woff2`. English
// on purpose: Onest's latin files carry no CJK glyphs, and a share card is
// fetched by a crawler with no language of its own. The brand's hexes,
// because this renders outside the stylesheet (docs/design.md, "Component
// rules"): paper ground, the logo on its indigo plate, indigo-tinted ink.
const en = JSON.parse(readFileSync(join(app, 'src', 'messages', 'en.json'), 'utf8'));
const logo = `data:image/svg+xml;base64,${readFileSync(join(app, 'public', 'logo.svg')).toString('base64')}`;
const onest = (weight) => readFileSync(join(app, 'assets', 'fonts', `onest-latin-${weight}-normal.woff`));
const div = (style, ...children) => ({ type: 'div', props: { style, children: children.length === 1 ? children[0] : children } });
const card = div(
  { width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 64, padding: 96, background: '#f8f5ef', color: '#101524', fontFamily: 'Onest' },
  { type: 'img', props: { src: logo, width: 240, height: 240, alt: '' } },
  div(
    { display: 'flex', flexDirection: 'column', flex: 1 },
    div({ fontWeight: 700, fontSize: 84, letterSpacing: -2 }, en.common.appName),
    div({ fontWeight: 400, marginTop: 24, fontSize: 36, lineHeight: 1.35, color: '#555b69' }, en.home.tagline),
  ),
);
const svg = await satori(card, {
  width: 1200,
  height: 630,
  fonts: [
    { name: 'Onest', data: onest(400), weight: 400, style: 'normal' },
    { name: 'Onest', data: onest(700), weight: 700, style: 'normal' },
  ],
});
await sharp(Buffer.from(svg)).png().toFile(join(out, 'opengraph-image.png'));

console.log(`public pages prerendered into ${out}${legal ? '' : ' (no LEGAL_DIR: no legal pages)'}`);
