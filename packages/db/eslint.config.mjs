import tseslint from 'typescript-eslint';

export default tseslint.config(
  // A config object carrying nothing but `ignores` is the global one.
  // `src/generated/**` is the Prisma client — generated, not authored; the
  // schema is where a change to it is made.
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/**'] },
  ...tseslint.configs.recommended,
);
