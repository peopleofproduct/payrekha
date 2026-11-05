import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'clients/**', 'coverage/**', 'playground/payrekha-web.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', performance: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', AbortSignal: 'readonly', Buffer: 'readonly', URL: 'readonly', NodeJS: 'readonly', TextEncoder: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
);
