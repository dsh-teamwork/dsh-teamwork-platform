import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { documentViewer } from './scripts/document-viewer.mjs';
import { publicPages } from './scripts/vite-pages.mjs';

// Under `pnpm dev` the Go server on :3800 is the one address a browser opens:
// it takes the console's index.html, its modules and the public pages from
// this Vite server on :3810 (DEV_VITE), so the pages, the API and the session
// share one origin, as in production. Hot updates connect here directly, and
// survive the Go server restarting.
//
// The build has a second entry, the public pages' script; the manifest tells
// scripts/prerender.mjs its file and the console's stylesheet.
export default defineConfig({
  plugins: [react(), tailwindcss(), publicPages(), documentViewer()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 3810, strictPort: true, hmr: { clientPort: 3810 } },
  build: {
    manifest: true,
    rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), public: fileURLToPath(new URL('./src/public/client.ts', import.meta.url)) } },
  },
});
