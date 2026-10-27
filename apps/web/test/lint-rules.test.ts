// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

// The type-aware rules need a file the TypeScript project knows, so the snippets are linted
// under the path of a real file in apps/web/src. Only the text differs.
const vueFile = 'apps/web/src/App.vue';
const tsFile = 'apps/web/src/format.ts';

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const template = (body: string) =>
  `<script setup lang="ts">\nconst m = 'x';\n</script>\n<template>\n  ${body}\n</template>\n`;

describe('HTML injection is banned in templates', () => {
  it.each([
    ['<p :innerHTML="m" />', 'vue/no-restricted-v-bind'],
    ['<p v-bind:innerHTML.prop="m" />', 'vue/no-restricted-v-bind'],
    ['<p :outerHTML="m" />', 'vue/no-restricted-v-bind'],
    ['<p v-bind="{ innerHTML: m }" />', 'vue/no-restricted-syntax'],
    ['<p v-bind="{ outerHTML: m }" />', 'vue/no-restricted-syntax'],
  ])('%s', async (body, rule) => {
    expect(await ruleIds(template(body), vueFile)).toContain(rule);
  });

  it.each(['<p>{{ m }}</p>', '<p :title="m" />'])('allows %s', async (body) => {
    expect(await ruleIds(template(body), vueFile)).toEqual([]);
  });
});

describe('HTML injection is banned in web source code', () => {
  it.each([
    'export const a = (el: Element, m: string) => { el.innerHTML = m; };',
    'export const a = (el: Element, m: string) => { el.outerHTML = m; };',
    "export const a = (el: Element, m: string) => { el.insertAdjacentHTML('beforeend', m); };",
    'export const a = (m: string) => { document.write(m); };',
  ])('%s', async (code) => {
    expect(await ruleIds(code, tsFile)).toContain('no-restricted-properties');
  });

  it('allows textContent', async () => {
    const code = 'export const a = (el: Element, m: string) => { el.textContent = m; };';
    expect(await ruleIds(code, tsFile)).toEqual([]);
  });

  // The HTML entries live in a later config block, which replaces the money entries for the
  // same files unless it repeats them.
  it('still bans toFixed in web source', async () => {
    const code = 'export const a = (n: number) => n.toFixed(2);';
    expect(await ruleIds(code, tsFile)).toContain('no-restricted-properties');
  });
});
