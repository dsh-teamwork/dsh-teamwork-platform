import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The community management console, served by the binary at /manage on an
// instance with ADMIN_EMAILS set. `pnpm --filter @dsh-teamwork/manage dev`
// serves it on :3802 and sends /api to the server on :3801; start the server
// with APP_URL=http://localhost:3802, since a write must come from APP_URL's origin.
export default defineConfig({
  base: '/manage/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:3801' } },
});
