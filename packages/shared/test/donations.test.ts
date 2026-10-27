import { describe, expect, it } from 'vitest';
import {
  DonationReceiptSchema,
  DonationRequestSchema,
  IdempotencyKeySchema,
  codePointLength,
  normaliseName,
} from '../src/donations.js';
import { isApiErrorBody } from '../src/errors.js';

const valid = {
  campaignSlug: 'aangan-courtyard',
  amountCents: 10100,
  donor: { fullName: 'Anisha Gurung', email: 'anisha@example.com' },
  privacyMode: 'public',
  paymentToken: 'tok_ok',
};

function issuesOf(input: unknown) {
  const result = DonationRequestSchema.safeParse(input);
  return result.success ? [] : result.error.issues;
}

describe('DonationRequestSchema', () => {
  it('accepts the minimal body and fills the defaults', () => {
    const result = DonationRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.isRecurring).toBe(false);
  });

  it('accepts a dedication, a message and null for both', () => {
    const full = {
      ...valid,
      dedication: { type: 'in_memory_of', name: 'Aama' },
      message: 'For the courtyard.',
      isRecurring: true,
    };
    expect(DonationRequestSchema.safeParse(full).success).toBe(true);
    expect(
      DonationRequestSchema.safeParse({ ...valid, dedication: null, message: null }).success,
    ).toBe(true);
  });

  it.each([
    ['99', 99],
    ['2500001', 2_500_001],
    ['-100', -100],
    ['1.5', 1.5],
    ['the string "100"', '100'],
    ['null', null],
    ['NaN', Number.NaN],
  ])('rejects an amount of %s on the amountCents path', (_label, amountCents) => {
    const issues = issuesOf({ ...valid, amountCents });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.path).toEqual(['amountCents']);
  });

  it.each([100, 2_500_000])('accepts the boundary amount %i', (amountCents) => {
    expect(DonationRequestSchema.safeParse({ ...valid, amountCents }).success).toBe(true);
  });

  it.each([
    ['status', { ...valid, status: 'completed' }],
    ['donorId', { ...valid, donorId: 'x' }],
    ['currency', { ...valid, currency: 'USD' }],
    ['donor.role', { ...valid, donor: { ...valid.donor, role: 'admin' } }],
    ['dedication.extra', { ...valid, dedication: { type: 'in_honor_of', name: 'A', x: 1 } }],
  ])('rejects an unknown key: %s', (_label, body) => {
    expect(DonationRequestSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['a missing privacyMode', { ...valid, privacyMode: undefined }],
    ['an unknown privacyMode', { ...valid, privacyMode: 'private' }],
    ['a dedication with a type and no name', { ...valid, dedication: { type: 'in_honor_of' } }],
    ['a dedication with a name and no type', { ...valid, dedication: { name: 'Aama' } }],
    ['an unknown dedication type', { ...valid, dedication: { type: 'gift', name: 'A' } }],
    ['a token without the tok_ prefix', { ...valid, paymentToken: 'ok' }],
    ['a token with upper case', { ...valid, paymentToken: 'tok_OK' }],
    ['a token of 61 characters', { ...valid, paymentToken: `tok_${'a'.repeat(61)}` }],
    ['an upper-case slug', { ...valid, campaignSlug: 'Aangan' }],
    ['a non-boolean isRecurring', { ...valid, isRecurring: 'yes' }],
    ['an empty body', {}],
    ['null', null],
  ])('rejects %s', (_label, body) => {
    expect(DonationRequestSchema.safeParse(body).success).toBe(false);
  });

  describe('message', () => {
    it('allows 280 code points and rejects 281, counting an emoji as one', () => {
      const ok = DonationRequestSchema.safeParse({ ...valid, message: '😀'.repeat(280) });
      expect(ok.success).toBe(true);
      const issues = issuesOf({ ...valid, message: '😀'.repeat(281) });
      expect(issues[0]?.code).toBe('too_big');
      expect(issues[0]?.path).toEqual(['message']);
    });

    it('turns a blank message into null and trims the rest', () => {
      expect(DonationRequestSchema.parse({ ...valid, message: '  \n ' }).message).toBeNull();
      expect(DonationRequestSchema.parse({ ...valid, message: '  hi  ' }).message).toBe('hi');
    });

    it('keeps line breaks and rejects other control characters', () => {
      expect(DonationRequestSchema.parse({ ...valid, message: 'a\nb' }).message).toBe('a\nb');
      expect(issuesOf({ ...valid, message: 'a\u0000b' })[0]?.path).toEqual(['message']);
      expect(issuesOf({ ...valid, message: 'a\tb' })[0]?.path).toEqual(['message']);
    });

    it('composes to NFC before counting', () => {
      const nfd = 'e\u0301'.repeat(280);
      expect(DonationRequestSchema.parse({ ...valid, message: nfd }).message).toBe('é'.repeat(280));
    });
  });

  describe('names and email', () => {
    it('normalises the donor name', () => {
      const parsed = DonationRequestSchema.parse({
        ...valid,
        donor: { ...valid.donor, fullName: '  Anisha\u00A0\t Gurung ' },
      });
      expect(parsed.donor.fullName).toBe('Anisha Gurung');
    });

    it('allows 100 code points and rejects 101 and empty', () => {
      const name = (fullName: string) => ({ ...valid, donor: { ...valid.donor, fullName } });
      expect(DonationRequestSchema.safeParse(name('😀'.repeat(100))).success).toBe(true);
      expect(issuesOf(name('😀'.repeat(101)))[0]?.code).toBe('too_big');
      expect(issuesOf(name('  \u200B '))[0]?.code).toBe('too_small');
    });

    it('applies the same name rules to the dedication', () => {
      const parsed = DonationRequestSchema.parse({
        ...valid,
        dedication: { type: 'in_honor_of', name: ' Aama\u202FJi ' },
      });
      expect(parsed.dedication?.name).toBe('Aama Ji');
    });

    it('rejects a control character in a name', () => {
      const body = { ...valid, donor: { ...valid.donor, fullName: 'A\u0000B' } };
      expect(issuesOf(body)[0]?.path).toEqual(['donor', 'fullName']);
    });

    it('trims and lower-cases the email', () => {
      const parsed = DonationRequestSchema.parse({
        ...valid,
        donor: { ...valid.donor, email: '  Anisha@Example.COM ' },
      });
      expect(parsed.donor.email).toBe('anisha@example.com');
    });

    it.each(['not-an-email', 'a@', '', `${'a'.repeat(250)}@example.com`])(
      'rejects the email %s',
      (email) => {
        const issues = issuesOf({ ...valid, donor: { ...valid.donor, email } });
        expect(issues[0]?.path).toEqual(['donor', 'email']);
      },
    );
  });
});

describe('normaliseName', () => {
  it.each([
    ['a no-break space', 'a\u00A0b', 'a b'],
    ['a narrow no-break space', 'a\u202Fb', 'a b'],
    ['a zero-width space', 'a\u200Bb', 'a b'],
    ['a BOM', 'a\uFEFFb', 'a b'],
    ['a word joiner', 'a\u2060b', 'a b'],
    ['only a word joiner', '\u2060', ''],
    ['a run of tabs and spaces', 'a \t\t  b', 'a b'],
    ['edges', '  a  ', 'a'],
    ['only separators', ' \u200B\u00A0 ', ''],
    ['NFD composed to NFC', 'e\u0301', 'é'],
  ])('%s', (_label, input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });

  it('keeps ZWJ and ZWNJ, which Devanagari conjuncts depend on', () => {
    const conjunct = 'क\u094D\u200Dष';
    expect(normaliseName(conjunct)).toBe(conjunct);
    const nonJoiner = 'क\u094D\u200Cष';
    expect(normaliseName(nonJoiner)).toBe(nonJoiner);
  });
});

describe('IdempotencyKeySchema', () => {
  const key = '3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f';

  it('accepts a canonical UUID and lower-cases it', () => {
    expect(IdempotencyKeySchema.parse(key)).toBe(key);
    expect(IdempotencyKeySchema.parse(key.toUpperCase())).toBe(key);
  });

  it.each([
    ['empty', ''],
    ['no hyphens', key.replaceAll('-', '')],
    ['braces', `{${key}}`],
    ['a trailing space', `${key} `],
    ['a short string', 'abc'],
    ['a non-hex digit', key.replace('3f', 'zz')],
    ['a number', 42],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(IdempotencyKeySchema.safeParse(input).success).toBe(false);
  });
});

describe('DonationReceiptSchema', () => {
  const receipt = {
    id: '3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f',
    receiptNumber: 'HCC-2026-000076',
    amountCents: 10100,
    currency: 'USD',
    status: 'completed',
    createdAt: '2026-10-27T10:00:00.000Z',
  };

  it('accepts a receipt, including a number past six digits', () => {
    expect(DonationReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(
      DonationReceiptSchema.safeParse({ ...receipt, receiptNumber: 'HCC-2026-1234567' }).success,
    ).toBe(true);
  });

  it.each([
    ['an extra key', { ...receipt, donorId: 'x' }],
    ['a short receipt number', { ...receipt, receiptNumber: 'HCC-2026-76' }],
    ['a failed status', { ...receipt, status: 'failed' }],
    ['an offset date', { ...receipt, createdAt: '2026-10-27T10:00:00+05:45' }],
    ['a lower-case currency', { ...receipt, currency: 'usd' }],
  ])('rejects %s', (_label, body) => {
    expect(DonationReceiptSchema.safeParse(body).success).toBe(false);
  });
});

describe('donation error codes', () => {
  it.each([
    'idempotency_key_required',
    'idempotency_key_mismatch',
    'request_in_progress',
    'card_declined',
    'insufficient_funds',
    'payment_provider_error',
    'campaign_closed',
    'amount_out_of_range',
    'rate_limited',
  ])('the web client reads a %s envelope', (code) => {
    expect(isApiErrorBody({ error: { code, message: 'x' } })).toBe(true);
  });
});

describe('codePointLength', () => {
  it('counts an emoji as one and a combining mark as its own', () => {
    expect(codePointLength('😀')).toBe(1);
    expect(codePointLength('e\u0301')).toBe(2);
  });
});
