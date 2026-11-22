// The document that previews a session's PDF or workbook, on the console and in the App alike: src/lib/document-viewer.ts
// with the renderers it mounts and their workers, bundled into one self-contained page whose CSP allows no request
// and no eval. Agent-written files are untrusted, so the console shows this page in an iframe sandboxed without
// same-origin (`virtual:document-viewer`, documentViewer() below), and the App's Metro transformer loads it into its
// WebView: a hostile PDF or workbook never runs where a session or a relay key lives.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(web, 'src/lib/document-viewer.ts');
const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; font-src blob: data:; img-src blob: data:";

/** The page, and every source file it was built from (to watch, or to key a cache by). */
export async function buildDocumentViewer() {
  const { outputFiles, metafile } = await build({
    entryPoints: [entry], absWorkingDir: web, bundle: true, write: false, metafile: true, minify: true,
    format: 'iife', target: ['safari16', 'chrome109'],
    plugins: [{
      // `?raw` imports (the pdf.js worker, SheetJS for the workbook worker) as their text, as Vite reads them.
      name: 'raw',
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, ({ path, resolveDir }) => ({
          path: createRequire(join(resolveDir, 'x')).resolve(path.slice(0, -'?raw'.length)), namespace: 'raw',
        }));
        b.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({ contents: await readFile(path, 'utf8'), loader: 'text' }));
      },
    }],
  });
  const script = outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    '<style>html,body,#viewer{height:100%;margin:0}</style><div id="viewer"></div>' +
    `<script>${script}</script>`;
  const inputs = Object.keys(metafile.inputs).map((input) => resolve(web, input.replace(/^raw:/, '')));
  return { html, inputs };
}

/** `import html from 'virtual:document-viewer'`: the page above as a string, rebuilt when one of its sources changes. */
export function documentViewer() {
  const id = 'virtual:document-viewer';
  return {
    name: 'document-viewer',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(loaded) {
      if (loaded !== `\0${id}`) return undefined;
      const { html, inputs } = await buildDocumentViewer();
      for (const input of inputs) this.addWatchFile(input);
      return `export default ${JSON.stringify(html)};`;
    },
  };
}
