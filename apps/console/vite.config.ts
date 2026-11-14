import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev` serves the console on :3801 and sends /api to the Go server on
// :3800. Start that one with APP_URL=http://localhost:3801: a write must come
// from APP_URL's origin, and the session cookie belongs to it.
//
// The build has a second entry, the public pages' script; the manifest tells
// scripts/prerender.mjs its file and the console's stylesheet.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:3800' } },
  build: {
    manifest: true,
    rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), public: fileURLToPath(new URL('./src/public/client.ts', import.meta.url)) } },
  },
});
