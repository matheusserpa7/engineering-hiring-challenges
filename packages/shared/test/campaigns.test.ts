import { describe, expect, it } from 'vitest';
import {
  CampaignSlugSchema,
  PublicCampaignSchema,
  PublicDonationListSchema,
  PublicDonationSchema,
  RecentDonationsQuerySchema,
} from '../src/campaigns.js';
import { isApiErrorBody } from '../src/errors.js';

const uuid = '3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f';

describe('CampaignSlugSchema', () => {
  it.each(['aangan-courtyard', 'roof-repair-2025', 'a', 'a'.repeat(64)])('accepts %s', (slug) => {
    expect(CampaignSlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ['an upper-case letter', 'Aangan'],
    ['an underscore', 'a_b'],
    ['a path traversal', '../x'],
    ['an empty string', ''],
    ['65 characters', 'a'.repeat(65)],
    ['a leading hyphen', '-a'],
    ['a trailing hyphen', 'a-'],
    ['a doubled hyphen', 'a--b'],
    ['a space', 'a b'],
    ['a non-ASCII letter', 'aangán'],
  ])('rejects %s', (_label, slug) => {
    expect(CampaignSlugSchema.safeParse(slug).success).toBe(false);
  });
});

describe('RecentDonationsQuerySchema', () => {
  // Express gives strings (or arrays), never numbers: a later switch to z.coerce would
  // start accepting these and fail here.
  it.each([
    ['null', null],
    ['a number', 5],
    ['an object', { n: 5 }],
  ])('rejects %s as the limit', (_label, raw) => {
    expect(RecentDonationsQuerySchema.safeParse({ limit: raw }).success).toBe(false);
  });

  it('accepts a limit that is present but undefined, like an absent one', () => {
    expect(RecentDonationsQuerySchema.safeParse({ limit: undefined }).success).toBe(true);
  });

  it('leaves the limit absent when the query has none', () => {
    const result = RecentDonationsQuerySchema.safeParse({});
    expect(result.success && result.data.limit).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it.each([
    ['1', 1],
    ['20', 20],
    ['50', 50],
    ['007', 7],
  ])('turns the string %s into the number %i', (raw, expected) => {
    const result = RecentDonationsQuerySchema.safeParse({ limit: raw });
    expect(result.success && result.data.limit).toBe(expected);
  });

  // z.coerce would turn '' into 0 and '1e1' into 10; the digit check refuses both first.
  it.each([
    ['zero', '0'],
    ['51', '51'],
    ['a negative number', '-1'],
    ['a plus sign', '+5'],
    ['a decimal', '1.5'],
    ['exponent notation', '1e1'],
    ['letters', 'abc'],
    ['an empty string', ''],
    ['a leading space', ' 5'],
    ['four digits', '0001'],
    ['a repeated key, which Express parses as an array', ['1', '2']],
  ])('rejects %s', (_label, raw) => {
    expect(RecentDonationsQuerySchema.safeParse({ limit: raw }).success).toBe(false);
  });

  it('rejects an unknown query key', () => {
    expect(RecentDonationsQuerySchema.safeParse({ limit: '5', page: '2' }).success).toBe(false);
  });
});

describe('PublicDonationSchema', () => {
  const donation = {
    id: uuid,
    displayName: 'The Gurung family',
    amountCents: 5100,
    dedication: { type: 'in_honor_of', name: 'Hajurama' },
    message: 'For the courtyard.',
    createdAt: '2026-08-02T12:20:00.000Z',
  };

  it('accepts a full donation', () => {
    expect(PublicDonationSchema.safeParse(donation).success).toBe(true);
  });

  it('accepts a null dedication and a null message', () => {
    expect(
      PublicDonationSchema.safeParse({ ...donation, dedication: null, message: null }).success,
    ).toBe(true);
  });

  // The strict schema is the privacy contract: a field that is not listed cannot appear.
  it.each(['donorName', 'email', 'donorId', 'isAnonymous'])('rejects an extra %s key', (key) => {
    expect(PublicDonationSchema.safeParse({ ...donation, [key]: 'x' }).success).toBe(false);
  });

  // JSON.parse makes __proto__ an own key; an object literal with a computed key would not.
  it('rejects a __proto__ key that arrived in JSON', () => {
    const body: unknown = JSON.parse(
      '{"id":"3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f","displayName":"A","amountCents":5100,"dedication":null,"message":null,"createdAt":"2026-08-02T12:20:00.000Z","__proto__":{"email":"x"}}',
    );
    expect(PublicDonationSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['an amount below the minimum', { amountCents: 99 }],
    ['a fractional amount', { amountCents: 100.5 }],
    ['an unknown dedication type', { dedication: { type: 'in_spite_of', name: 'x' } }],
    ['a dedication with an extra key', { dedication: { type: 'in_memory_of', name: 'x', id: 1 } }],
    ['an id that is not a uuid', { id: '42' }],
    ['a date without a time', { createdAt: '2026-08-02' }],
    ['an empty display name', { displayName: '' }],
  ])('rejects %s', (_label, change) => {
    expect(PublicDonationSchema.safeParse({ ...donation, ...change }).success).toBe(false);
  });
});

describe('PublicCampaignSchema', () => {
  const campaign = {
    id: uuid,
    slug: 'aangan-courtyard',
    title: 'Aangan — Courtyard Restoration',
    story: 'The courtyard is where the community happens.',
    currency: 'USD',
    goalCents: 15_000_000,
    raisedCents: 4_305_800,
    donorCount: 46,
    progressPercent: 28,
    presetCents: [2100, 5100, 10_100, 50_100, 100_100],
    minCents: 100,
    maxCents: 2_500_000,
    isActive: true,
    phase: 'open',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
  };

  it('accepts a full campaign', () => {
    expect(PublicCampaignSchema.safeParse(campaign).success).toBe(true);
  });

  it('accepts null dates, as Annadaan has no end', () => {
    expect(
      PublicCampaignSchema.safeParse({ ...campaign, startsAt: null, endsAt: null }).success,
    ).toBe(true);
  });

  it.each(['upcoming', 'open', 'closed'])('accepts the phase %s', (phase) => {
    expect(PublicCampaignSchema.safeParse({ ...campaign, phase }).success).toBe(true);
  });

  // The number may honestly read 115%; only the bar is capped, in the page.
  it('accepts a progress above 100', () => {
    expect(PublicCampaignSchema.safeParse({ ...campaign, progressPercent: 115 }).success).toBe(
      true,
    );
  });

  it.each([
    ['an unknown phase', { phase: 'archived' }],
    ['an extra key', { donors: [] }],
    ['a negative total', { raisedCents: -1 }],
    ['a total past the safe integers', { raisedCents: 2 ** 60 }],
    ['a fractional total', { raisedCents: 100.5 }],
    ['a fractional progress', { progressPercent: 28.5 }],
    ['a negative donor count', { donorCount: -1 }],
    ['a preset below the minimum', { presetCents: [50] }],
    ['a currency that is not three letters', { currency: 'US' }],
    ['a date that is not ISO', { startsAt: 'August 1' }],
  ])('rejects %s', (_label, change) => {
    expect(PublicCampaignSchema.safeParse({ ...campaign, ...change }).success).toBe(false);
  });
});

describe('the error envelope', () => {
  it('knows validation_failed and its details array', () => {
    const body = {
      error: {
        code: 'validation_failed',
        message: 'The query is invalid.',
        details: [{ field: 'limit', issue: 'too_big' }],
      },
    };
    expect(isApiErrorBody(body)).toBe(true);
  });
});

describe('PublicDonationListSchema', () => {
  const item = {
    id: uuid,
    displayName: 'Anonymous',
    amountCents: 2100,
    dedication: null,
    message: null,
    createdAt: '2026-08-02T11:45:00.000Z',
  };

  it('accepts an empty list and a list of donations', () => {
    expect(PublicDonationListSchema.safeParse({ data: [] }).success).toBe(true);
    expect(PublicDonationListSchema.safeParse({ data: [item, item] }).success).toBe(true);
  });

  it.each([
    ['a bare array', [item]],
    ['a missing data key', {}],
    ['data that is not an array', { data: item }],
    ['an extra top-level key', { data: [], total: 1 }],
    ['an item with an extra key', { data: [{ ...item, email: 'a@b.org' }] }],
  ])('rejects %s', (_label, body) => {
    expect(PublicDonationListSchema.safeParse(body).success).toBe(false);
  });
});
