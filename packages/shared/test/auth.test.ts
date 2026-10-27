import { describe, expect, it } from 'vitest';
import { LoginRequestSchema, SessionResponseSchema, SessionUserSchema } from '../src/auth.js';
import {
  AdminDonationQuerySchema,
  AdminDonationSchema,
  AdminDonationPageSchema,
  DonationDetailSchema,
  RefundRequestSchema,
} from '../src/donor-records.js';
import { ERROR_CODES } from '../src/errors.js';

const uuid = '3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f';

describe('LoginRequestSchema', () => {
  it('trims and lower-cases the email and keeps the password as typed', () => {
    const parsed = LoginRequestSchema.parse({ email: '  Admin@Example.ORG ', password: ' pw ' });
    expect(parsed).toEqual({ email: 'admin@example.org', password: ' pw ' });
  });

  it.each([
    ['an unknown key (role)', { email: 'a@b.co', password: 'x', role: 'admin' }],
    ['a missing password', { email: 'a@b.co' }],
    ['an empty password', { email: 'a@b.co', password: '' }],
    ['a 257-code-point password', { email: 'a@b.co', password: 'a'.repeat(257) }],
    ['a non-string password', { email: 'a@b.co', password: 12345 }],
    ['a malformed email', { email: 'nope', password: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(LoginRequestSchema.safeParse(body).success).toBe(false);
  });

  it('counts the password in code points, not UTF-16 units', () => {
    expect(
      LoginRequestSchema.safeParse({ email: 'a@b.co', password: '😀'.repeat(256) }).success,
    ).toBe(true);
    expect(
      LoginRequestSchema.safeParse({ email: 'a@b.co', password: '😀'.repeat(257) }).success,
    ).toBe(false);
  });
});

describe('SessionResponseSchema', () => {
  const user = { id: uuid, email: 'a@b.co', fullName: 'Asha', role: 'donor' };

  it('accepts a user with a known role', () => {
    expect(SessionResponseSchema.safeParse({ user }).success).toBe(true);
    expect(SessionUserSchema.safeParse({ ...user, role: 'admin' }).success).toBe(true);
  });

  it.each([
    ['an extra key on the user', { user: { ...user, passwordHash: 'x' } }],
    ['an extra key on the body', { user, token: 'x' }],
    ['an unknown role', { user: { ...user, role: 'root' } }],
  ])('rejects %s', (_label, body) => {
    expect(SessionResponseSchema.safeParse(body).success).toBe(false);
  });
});

const detail = {
  id: uuid,
  receiptNumber: 'HCC-2025-000021',
  campaign: { slug: 'aangan-courtyard', title: 'Aangan' },
  donorName: 'Asha',
  amountCents: 5100,
  currency: 'USD',
  status: 'completed',
  privacyMode: 'public',
  dedication: null,
  message: null,
  createdAt: '2025-03-01T10:00:00.000Z',
  refundedAt: null,
};

describe('DonationDetailSchema and AdminDonationSchema', () => {
  it('accepts a detail row and rejects an extra key', () => {
    expect(DonationDetailSchema.safeParse(detail).success).toBe(true);
    expect(DonationDetailSchema.safeParse({ ...detail, donorEmail: 'a@b.co' }).success).toBe(false);
  });

  it('adds the donor email and failure code for the admin', () => {
    const admin = { ...detail, donorEmail: 'a@b.co', failureCode: null };
    expect(AdminDonationSchema.safeParse(admin).success).toBe(true);
    expect(AdminDonationSchema.safeParse(detail).success).toBe(false);
    expect(AdminDonationSchema.safeParse({ ...admin, donorId: uuid }).success).toBe(false);
  });

  it('accepts a refunded row with its timestamp', () => {
    const refunded = { ...detail, status: 'refunded', refundedAt: '2025-03-02T10:00:00.000Z' };
    expect(DonationDetailSchema.safeParse(refunded).success).toBe(true);
  });

  it('rejects a status outside the four the database allows', () => {
    expect(DonationDetailSchema.safeParse({ ...detail, status: 'paid' }).success).toBe(false);
  });
});

describe('AdminDonationPageSchema', () => {
  const admin = { ...detail, donorEmail: 'a@b.co', failureCode: null };

  it('accepts the envelope and an empty last page', () => {
    const page = { data: [admin], page: 1, pageSize: 25, total: 1, totalPages: 1 };
    expect(AdminDonationPageSchema.safeParse(page).success).toBe(true);
    const empty = { data: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };
    expect(AdminDonationPageSchema.safeParse(empty).success).toBe(true);
  });

  it('rejects an extra key', () => {
    const page = { data: [], page: 1, pageSize: 25, total: 0, totalPages: 0, cursor: 'x' };
    expect(AdminDonationPageSchema.safeParse(page).success).toBe(false);
  });
});

describe('AdminDonationQuerySchema', () => {
  it('applies the defaults to an empty query', () => {
    expect(AdminDonationQuerySchema.parse({})).toEqual({
      sort: 'createdAt',
      dir: 'desc',
      page: 1,
      pageSize: 25,
    });
  });

  it('turns page and pageSize into numbers and keeps a valid filter', () => {
    const parsed = AdminDonationQuerySchema.parse({
      q: 'Asha',
      status: 'refunded',
      sort: 'amountCents',
      dir: 'asc',
      page: '3',
      pageSize: '100',
    });
    expect(parsed).toEqual({
      q: 'Asha',
      status: 'refunded',
      sort: 'amountCents',
      dir: 'asc',
      page: 3,
      pageSize: 100,
    });
  });

  it.each(['pending', 'completed', 'failed', 'refunded'])('accepts status %s', (status) => {
    expect(AdminDonationQuerySchema.safeParse({ status }).success).toBe(true);
  });

  // z.coerce.number() would accept '1e1' and '' and ' 2 ' as numbers.
  it.each(['0', '-1', '1.5', '1e1', '', ' 2 ', '1234567', 'abc'])('rejects page %j', (page) => {
    expect(AdminDonationQuerySchema.safeParse({ page }).success).toBe(false);
  });

  it.each(['0', '101', '1e1', '', '2.5'])('rejects pageSize %j', (pageSize) => {
    expect(AdminDonationQuerySchema.safeParse({ pageSize }).success).toBe(false);
  });

  it.each([
    ['a repeated page', { page: ['1', '2'] }],
    ['a repeated q', { q: ['a', 'b'] }],
    ['an unknown key', { limit: '5' }],
    ['an unknown sort', { sort: 'donor_email' }],
    ['an unknown dir', { dir: 'sideways' }],
    ['an unknown status', { status: 'paid' }],
    ['a control character in q', { q: 'a\u0007b' }],
    ['a q of 101 code points', { q: 'a'.repeat(101) }],
  ])('rejects %s', (_label, query) => {
    expect(AdminDonationQuerySchema.safeParse(query).success).toBe(false);
  });

  it('normalises q to NFC and drops a blank one', () => {
    // e + combining acute really is decomposed; the expected value is a literal precomposed é.
    expect(AdminDonationQuerySchema.parse({ q: 'Zoé' }).q).toBe('Zoé');
    expect(AdminDonationQuerySchema.parse({ q: 'गुरुङ' }).q).toBe('गुरुङ');
    // The key stays, as undefined; callers test `q !== undefined`.
    expect(AdminDonationQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(AdminDonationQuerySchema.parse({ q: '' }).q).toBeUndefined();
  });

  it.each(['status', 'sort', 'dir'])('rejects an empty %s', (key) => {
    expect(AdminDonationQuerySchema.safeParse({ [key]: '' }).success).toBe(false);
  });

  it('counts q in code points', () => {
    expect(AdminDonationQuerySchema.safeParse({ q: '😀'.repeat(100) }).success).toBe(true);
    expect(AdminDonationQuerySchema.safeParse({ q: '😀'.repeat(101) }).success).toBe(false);
  });
});

describe('RefundRequestSchema', () => {
  it('trims and normalises the reason to NFC', () => {
    const parsed = RefundRequestSchema.parse({ reason: `  ${'é'.normalize('NFD')} duplicate  ` });
    expect(parsed.reason).toBe('é duplicate');
  });

  it('allows line breaks inside the reason', () => {
    expect(RefundRequestSchema.safeParse({ reason: 'one\ntwo' }).success).toBe(true);
  });

  it('counts the reason in code points: 500 emoji pass, 501 fail', () => {
    expect(RefundRequestSchema.safeParse({ reason: '😀'.repeat(500) }).success).toBe(true);
    expect(RefundRequestSchema.safeParse({ reason: '😀'.repeat(501) }).success).toBe(false);
  });

  it.each([
    ['an empty reason', { reason: '' }],
    ['a blank reason', { reason: '   ' }],
    ['a reason of only zero-width characters', { reason: '​⁠' }],
    ['a missing reason', {}],
    ['a control character', { reason: 'a\u0000b' }],
    ['an unknown key (amountCents)', { reason: 'x', amountCents: 1 }],
    ['a non-string reason', { reason: 5 }],
  ])('rejects %s', (_label, body) => {
    expect(RefundRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('error codes for spec 005', () => {
  it.each([
    'unauthenticated',
    'forbidden',
    'invalid_credentials',
    'already_refunded',
    'not_refundable',
    'origin_not_allowed',
  ])('includes %s', (code) => {
    expect(ERROR_CODES).toContain(code);
  });
});
