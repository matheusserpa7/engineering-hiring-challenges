import { describe, expect, it } from 'vitest';
import {
  AmountCentsSchema,
  MAX_DONATION_CENTS,
  MIN_DONATION_CENTS,
  formatCents,
  parseDollarsToCents,
  progressPercent,
} from '../src/money.js';

describe('AmountCentsSchema: the donation range, $1.00 to $25,000.00', () => {
  it.each([
    ['$1.00, the minimum', 100],
    ['$25,000.00, the maximum', 2_500_000],
  ])('accepts %s', (_label, cents) => {
    expect(AmountCentsSchema.safeParse(cents).success).toBe(true);
  });

  it.each([
    ['$0.99, one cent under', 99],
    ['$25,000.01, one cent over', 2_500_001],
    ['a negative', -100],
    ['zero', 0],
    ['a fraction of a cent', 150.5],
    ['a numeric string', '100'],
    ['null', null],
    ['NaN', Number.NaN],
  ])('rejects %s', (_label, value) => {
    expect(AmountCentsSchema.safeParse(value).success).toBe(false);
  });

  it('uses the same limits it exports', () => {
    expect([MIN_DONATION_CENTS, MAX_DONATION_CENTS]).toEqual([100, 2_500_000]);
  });
});

describe('parseDollarsToCents', () => {
  it.each([
    ['0.99', 99],
    ['1.00', 100],
    ['1', 100],
    ['51.5', 5150],
    ['51.05', 5105],
    ['25000.00', 2_500_000],
    ['25000.01', 2_500_001],
    [' 51 ', 5100],
    ['0', 0],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each([
    ['letters', 'abc'],
    ['an empty string', ''],
    ['a negative', '-1'],
    ['a plus sign', '+1'],
    ['an exponent', '1e9'],
    ['a thousands separator', '1,000.00'],
    ['a third decimal', '1.234'],
    ['a trailing dot', '1.'],
    ['a leading dot', '.50'],
    ['a currency symbol', '$5'],
    ['more digits than any donation needs', '10000000'],
    ['null', null],
    ['a number instead of a string', 51],
  ])('rejects %s', (_label, input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe('formatCents', () => {
  it.each([
    [4_305_800, '$43,058.00'],
    [100, '$1.00'],
    [5, '$0.05'],
    [0, '$0.00'],
    [2_500_000, '$25,000.00'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it('formats a negative amount with its sign', () => {
    expect(formatCents(-5)).toBe('-$0.05');
  });

  // Dividing by 100 prints .90 here, so this fails if a float sneaks into the formatter.
  it('keeps every cent of the largest safe integer', () => {
    expect(formatCents(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91');
  });

  it('rejects a value that is not a whole number of cents', () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
  });
});

describe('progressPercent', () => {
  it.each([
    ['nothing raised', 0, 15_000_000, 0],
    ['part of the goal, rounded down', 4_305_800, 15_000_000, 28],
    ['exactly the goal', 15_000_000, 15_000_000, 100],
    ['past the goal, not capped', 2_300_000, 2_000_000, 115],
    ['a goal that is not positive', 500, 0, 0],
  ])('%s', (_label, raised, goal, percent) => {
    expect(progressPercent(raised, goal)).toBe(percent);
  });
});
