// Standalone flat config (self-contained — no monorepo shared config).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Unused imports/vars are cruft, not build breakers; underscore-prefixed
      // names are intentional (matches the tolerance the migrated code assumes).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Some SDK-mock tests reassign a global to itself on purpose.
      'no-self-assign': 'off',
    },
  },
  {
    // Node ESM tooling scripts — runtime/tsc validate these; no-undef is noise.
    files: ['**/*.mjs', 'scripts/**'],
    rules: { 'no-undef': 'off' },
  },
  { ignores: ['dist/**', 'src/generated/**', 'tests/fixtures/**'] },
)
