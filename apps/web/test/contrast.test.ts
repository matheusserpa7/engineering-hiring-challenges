// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)),
  'utf8',
);

function block(source: string, opener: string): Record<string, string> {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`tokens.css has no ${opener}`);
  const end = source.indexOf('}', start);
  const tokens: Record<string, string> = {};
  for (const m of source.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) tokens[name] = value;
  }
  return tokens;
}

const dark = css.indexOf('prefers-color-scheme: dark');
const light = block(css, ':root');
const themes = { light, dark: { ...light, ...block(css.slice(dark), ':root') } };

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// [foreground, background, minimum]: 4.5 for text, 3 for UI components (WCAG 1.4.3, 1.4.11).
const PAIRS: [string, string, number][] = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['ink', 'surface-2', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['brand-ink', 'brand', 4.5],
  ['brand', 'surface', 4.5],
  ['brand-strong', 'brand-soft', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['warn', 'warn-soft', 4.5],
  ['bad', 'bad-soft', 4.5],
  ['info', 'info-soft', 4.5],
  ['marigold-ink', 'marigold-soft', 4.5],
  ['bad', 'surface', 4.5],
  ['focus', 'surface', 3],
  ['focus', 'bg', 3],
  ['line-strong', 'surface', 3],
  ['line-strong', 'bg', 3],
];

describe.each(Object.entries(themes))('%s theme contrast', (_name, tokens) => {
  it.each(PAIRS)('%s on %s is at least %d:1', (fg, bg, min) => {
    const a = tokens[fg];
    const b = tokens[bg];
    if (a === undefined || b === undefined) throw new Error(`missing token ${fg} or ${bg}`);
    expect(ratio(a, b)).toBeGreaterThanOrEqual(min);
  });
});
