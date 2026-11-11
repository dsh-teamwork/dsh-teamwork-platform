import path from 'node:path';

import { defineConfig } from 'vitest/config';

// `node` is the default: a suite that needs the DOM opts in with
// `// @vitest-environment jsdom` on its first line. Every vitest workspace
// names its own `include` and excludes `dist`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws when imported outside a React Server Component
      // build, which a test is; the guard it provides is the bundler's, not
      // the test's.
      'server-only': path.resolve(__dirname, './src/test/empty.ts'),
    },
  },
});
