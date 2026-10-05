import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import globals from 'globals';

// Self-contained, like .github/scripts/i18n-review: this tool is deliberately
// outside the pnpm workspace, so it carries its own config instead of using
// the monorepo's shared factories. Plain @eslint/js covers the basics:
// undefined vars, unused vars, unreachable code.
export default defineConfig([
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'public/vendor/**'],
    extends: [eslint.configs.recommended],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-console': 'off',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
]);
