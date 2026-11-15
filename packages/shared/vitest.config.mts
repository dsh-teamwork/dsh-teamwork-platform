import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own include and excludes dist. The ESM
// extension also works with Vite's native config loader without a CJS warning.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
