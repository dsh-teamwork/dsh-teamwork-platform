import { defineConfig } from 'vitest/config';

// Every vitest workspace names its own `include` and excludes `dist`: Vitest 4
// dropped `**/dist/**` from its default exclude, so a compiled copy of a suite
// would otherwise run a second time against the last build.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // The database suites share one Postgres and clear the tables they touch.
    fileParallelism: false,
  },
});
