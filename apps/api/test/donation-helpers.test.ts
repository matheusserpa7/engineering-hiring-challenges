import type { DonationRequest } from '@aangan/shared';
import { describe, expect, it } from 'vitest';
import { receiptNumber, receiptYear, requestHash } from '../src/services/donations.js';

describe('receiptNumber', () => {
  it('pads the sequence to six digits', () => {
    expect(receiptNumber(2026, 76)).toBe('HCC-2026-000076');
  });

  it('does not truncate past 999,999, where SQL lpad would cut and collide', () => {
    expect(receiptNumber(2026, 1_234_567)).toBe('HCC-2026-1234567');
  });
});

describe('receiptYear', () => {
  const chicago = 'America/Chicago';

  it('is still 2026 one second before midnight in Chicago', () => {
    expect(receiptYear(new Date('2027-01-01T05:59:59Z'), chicago)).toBe(2026);
  });

  it('is 2027 at midnight in Chicago', () => {
    expect(receiptYear(new Date('2027-01-01T06:00:00Z'), chicago)).toBe(2027);
  });

  it('follows the configured zone, not the server clock zone', () => {
    expect(receiptYear(new Date('2026-12-31T20:30:00Z'), 'Asia/Kathmandu')).toBe(2027);
  });
});

describe('requestHash', () => {
  const base: DonationRequest = {
    campaignSlug: 'aangan-courtyard',
    amountCents: 10100,
    donor: { fullName: 'Anisha Gurung', email: 'anisha@example.com' },
    dedication: { type: 'in_honor_of', name: 'Aama' },
    message: 'For the courtyard.',
    privacyMode: 'public',
    isRecurring: false,
    paymentToken: 'tok_ok',
  };

  it('is a SHA-256 hex digest', () => {
    expect(requestHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the order of keys in the object', () => {
    const reordered: DonationRequest = {
      paymentToken: base.paymentToken,
      isRecurring: base.isRecurring,
      privacyMode: base.privacyMode,
      message: base.message,
      dedication: base.dedication,
      donor: { email: base.donor.email, fullName: base.donor.fullName },
      amountCents: base.amountCents,
      campaignSlug: base.campaignSlug,
    };
    expect(requestHash(reordered)).toBe(requestHash(base));
  });

  it('treats an omitted message and dedication like null', () => {
    const omitted: DonationRequest = { ...base };
    delete omitted.message;
    delete omitted.dedication;
    expect(requestHash(omitted)).toBe(requestHash({ ...base, message: null, dedication: null }));
  });

  it.each([
    ['the slug', { campaignSlug: 'annadaan-kitchen' }],
    ['the amount', { amountCents: 10101 }],
    ['the donor name', { donor: { ...base.donor, fullName: 'Anisha Gurun' } }],
    ['the email', { donor: { ...base.donor, email: 'other@example.com' } }],
    ['the dedication type', { dedication: { type: 'in_memory_of' as const, name: 'Aama' } }],
    ['the dedication name', { dedication: { type: 'in_honor_of' as const, name: 'Aba' } }],
    ['the message', { message: 'Other.' }],
    ['the privacy mode', { privacyMode: 'anonymous' as const }],
    ['the recurring flag', { isRecurring: true }],
    ['the payment token', { paymentToken: 'tok_decline' }],
  ])('changes when %s changes', (_label, change) => {
    expect(requestHash({ ...base, ...change })).not.toBe(requestHash(base));
  });
});
