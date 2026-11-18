import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  // A scripted socket and stubbed channel stand in for the wire's untyped frames.
  { files: ['src/__tests__/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
