import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The community management console, served by the binary at /manage on an
// instance with ADMIN_EMAILS set. Under `pnpm dev` the Go server on :3800
// passes /manage/ through to this Vite server on :3811 (DEV_VITE), so the
// console, the API and the session share one origin; hot updates connect here
// directly, and survive the Go server restarting.
export default defineConfig({
  base: '/manage/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 3811, strictPort: true, hmr: { clientPort: 3811 } },
});
