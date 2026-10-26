import { z } from 'zod';

// Money is integer cents everywhere (ADR 0002). These helpers are the only places that
// turn text into cents and cents into text, so a float has nowhere to sneak in.

export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 2_500_000;

// .int() rejects fractions of a cent; z.number() already rejects NaN and Infinity.
export const AmountCentsSchema = z.number().int().min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS);

// Whole dollars with an optional one or two decimals. Seven digits of dollars is far above
// any donation and keeps the result a safe integer. Commas are refused, not stripped:
// "1,000" is a thousand in en-US but one in many other locales.
const DOLLARS = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

// Returns null for anything that isn't a plain dollar amount. Range checks are
// AmountCentsSchema's job, so "0.99" parses to 99 and is rejected there.
export function parseDollarsToCents(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const match = DOLLARS.exec(input.trim());
  if (match === null) return null;
  const [, dollars = '', fraction = ''] = match;
  // "51.5" is fifty cents, so a single decimal is padded on the right.
  return Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
}

// Builds the exact decimal string by slicing digits, with no division, and lets
// Intl.NumberFormat format that string. It formats numeric strings exactly (ES2023).
// The cast only tells TypeScript what the slicing guarantees: digits, a dot, maybe a sign.
// Always USD: cents assume two decimal places, and every campaign is in USD.
export function formatCents(cents: number, locale = 'en-US'): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('formatCents expects a whole number of cents');
  }
  const digits = String(Math.abs(cents)).padStart(3, '0');
  const sign = cents < 0 ? '-' : '';
  const decimal = `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(
    decimal as Intl.StringNumericLiteral,
  );
}

// A whole percentage, rounded down so the page never claims more than was raised.
// Not capped at 100: the page caps the bar, while the number can honestly read 115%.
export function progressPercent(raisedCents: number, goalCents: number): number {
  if (goalCents <= 0) return 0;
  return Math.floor((raisedCents * 100) / goalCents);
}
