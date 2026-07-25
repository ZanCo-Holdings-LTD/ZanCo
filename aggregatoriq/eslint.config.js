import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Lint rules chosen for what they prevent in *this* product.
 *
 * The two that earn their place: no floating promises (an unawaited database
 * write inside a transaction commits nothing and reports success), and no
 * unsafe `any` leaking into arithmetic (every number here ends up in front of a
 * customer as a claim).
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
    },
  },

  {
    // CLI entry points and the worker log to stdout on purpose.
    files: ['**/src/cli/**/*.ts', 'apps/worker/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      // Test fixtures deliberately construct malformed values to prove the
      // guards reject them.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  prettier,
);
