import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// `node` is the default: a suite that needs the DOM opts in with
// `// @vitest-environment jsdom` on its first line. Every vitest workspace
// names its own `include` and excludes `dist`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
