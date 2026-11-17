// Renders the public pages to static HTML in dist/public/, after `vite build`
// and before the server embeds the result (server/scripts/embed.mjs): every
// page src/public/render.tsx returns (home in each locale and sign-in state,
// the documentation, privacy and terms when LEGAL_DIR is set), and the share
// card. The Go server embeds them and picks one per request
// (server/internal/web).
//
// Run directly, it renders this app. An edition's web app that composes this
// one (premium/apps/web) calls `prerender` with its own directory, whose
// render.tsx adds or replaces pages, and the source directory `@` names.
//
// LEGAL_DIR names a directory holding privacy.md and terms.md, absolute or
// relative to the repository root. Who is the data controller differs per
// deployment, so no text ships in this app; with LEGAL_DIR unset there are no
// legal pages and nothing links to them. A named file that is missing fails
// the build.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import satori from 'satori';
import sharp from 'sharp';
import { build } from 'vite';

import { legalSources } from './vite-pages.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Renders app's public pages into app/dist/public; src is what `@` names in its sources. */
export async function prerender({ app = web, src = join(web, 'src') } = {}) {
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
    resolve: { alias: { '@': src } },
    build: { ssr: join(app, 'src', 'public', 'render.tsx'), outDir: ssr, emptyOutDir: true },
  });
  const { renderPages } = await import(pathToFileURL(join(ssr, 'render.js')).href);

  const legal = legalSources();

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
  // rules"): white ground, the logo on its navy plate, near-black ink.
  const en = JSON.parse(readFileSync(join(web, 'src', 'messages', 'en.json'), 'utf8'));
  const logo = `data:image/svg+xml;base64,${readFileSync(join(web, 'public', 'logo.svg')).toString('base64')}`;
  const onest = (weight) => readFileSync(join(web, 'assets', 'fonts', `onest-latin-${weight}-normal.woff`));
  const div = (style, ...children) => ({ type: 'div', props: { style, children: children.length === 1 ? children[0] : children } });
  const card = div(
    { width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 64, padding: 96, background: '#ffffff', color: '#0a0a0b', fontFamily: 'Onest' },
    { type: 'img', props: { src: logo, width: 240, height: 240, alt: '' } },
    div(
      { display: 'flex', flexDirection: 'column', flex: 1 },
      div({ fontWeight: 700, fontSize: 84, letterSpacing: -2 }, en.common.appName),
      div({ fontWeight: 400, marginTop: 24, fontSize: 36, lineHeight: 1.35, color: '#5c5c66' }, en.home.tagline),
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

  const pages = readdirSync(out).filter((name) => name.endsWith('.html'));
  console.log(`public pages prerendered into ${out}${pages.some((name) => name === 'privacy.html') ? '' : ' (no legal pages)'}`);
}

if (import.meta.main) await prerender();
