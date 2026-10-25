import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Money is integer minor units end to end (ADR 0002). Float parsing and float
// formatting are the usual ways a rounding bug sneaks in, so lint bans them.
const moneyRules = {
  'no-restricted-globals': [
    'error',
    {
      name: 'parseFloat',
      message: 'Money is integer minor units: parse with the shared money helpers.',
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'Number',
      property: 'parseFloat',
      message: 'Money is integer minor units: parse with the shared money helpers.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.property.name='toFixed']",
      message: 'toFixed rounds floats: format money with the shared money helpers.',
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      'roles/**',
      '**/dist/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      ...moneyRules,
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: { 'vue/no-v-html': 'error' },
  },
  {
    // Plain JS here is config and tooling scripts, which have no tsconfig to type-check against.
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // CLI scripts and the agent hook talk to the terminal on purpose.
    files: ['scripts/**', '.claude/hooks/**'],
    rules: { 'no-console': 'off' },
  },

  prettier,
);
