import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Money is integer minor units end to end (ADR 0002). Float parsing and float
// formatting are the usual ways a rounding bug sneaks in, so lint bans them.
const parseMessage = 'Money is integer minor units: parse with the shared money helpers.';
const formatMessage = 'toFixed rounds floats: format money with the shared money helpers.';
// Donor text is hostile. Vue's {{ }} escapes it, so the only way to run it is to ask for raw HTML.
const htmlMessage = 'Raw HTML runs donor text as markup: render it with {{ }} or textContent.';

const moneyProperties = [
  { object: 'Number', property: 'parseFloat', message: parseMessage },
  // No object given, so any receiver matches: x.toFixed, x['toFixed'], destructuring.
  { property: 'toFixed', message: formatMessage },
];

const moneyRules = {
  'no-restricted-globals': [
    'error',
    {
      globals: [{ name: 'parseFloat', message: parseMessage }],
      // Also catches globalThis.parseFloat.
      checkGlobalObject: true,
    },
  ],
  'no-restricted-properties': ['error', ...moneyProperties],
};

// Core rules never see Vue template expressions, which is exactly where a price would
// be formatted, so the same bans are repeated for templates.
const templateMoneyRules = {
  'vue/no-restricted-syntax': [
    'error',
    { selector: "Identifier[name='parseFloat']", message: parseMessage },
    { selector: "MemberExpression[property.value='parseFloat']", message: parseMessage },
    { selector: "MemberExpression[property.name='toFixed']", message: formatMessage },
    { selector: "MemberExpression[property.value='toFixed']", message: formatMessage },
    // v-bind="{ innerHTML: m }" hides the property name from no-restricted-v-bind.
    { selector: 'Property[key.name=/^(inner|outer)HTML$/]', message: htmlMessage },
    { selector: 'Property[key.value=/^(inner|outer)HTML$/]', message: htmlMessage },
  ],
};

export default defineConfig(
  {
    ignores: [
      'roles/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
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
    rules: {
      ...templateMoneyRules,
      'vue/no-v-html': 'error',
      'vue/no-restricted-v-bind': ['error', '/^(inner|outer)HTML$/'],
      // TypeScript already reports undefined names, and this rule has no browser globals here.
      // That holds only if every script block is TypeScript, so block-lang enforces it.
      'no-undef': 'off',
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
    },
  },
  {
    // Component tests may read innerHTML to assert escaping, so only the shipped source is
    // covered. This block replaces the money entries for these files, so it repeats them.
    files: ['apps/web/src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...moneyProperties,
        { property: 'innerHTML', message: htmlMessage },
        { property: 'outerHTML', message: htmlMessage },
        { property: 'insertAdjacentHTML', message: htmlMessage },
        { object: 'document', property: 'write', message: htmlMessage },
      ],
    },
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
