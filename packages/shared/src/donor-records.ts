import { z } from 'zod';
import { CampaignSlugSchema } from './campaigns.js';
import {
  CONTROL,
  CONTROL_EXCEPT_LINE_BREAK,
  PRIVACY_MODES,
  boundedText,
  normaliseName,
} from './donations.js';
import { AmountCentsSchema } from './money.js';

// What a donor sees of their own donations and what the office sees of all of them (tech spec
// 005 §2 and §5). Strict like every response schema: a payload that gains a donor id or a
// token fails the web client and the API's tests.

export const DONATION_STATUSES = ['pending', 'completed', 'failed', 'refunded'] as const;
export const ADMIN_SORTS = ['createdAt', 'amountCents'] as const;
export const DEFAULT_ADMIN_PAGE_SIZE = 25;
export const MAX_ADMIN_PAGE_SIZE = 100;
export const MAX_SEARCH_CODE_POINTS = 100;
export const MAX_REFUND_REASON_CODE_POINTS = 500;

const isoDate = z.iso.datetime();

export const DonationDetailSchema = z.strictObject({
  id: z.uuid(),
  receiptNumber: z.string().regex(/^HCC-\d{4}-\d{6,}$/),
  campaign: z.strictObject({ slug: CampaignSlugSchema, title: z.string().min(1) }),
  donorName: z.string().min(1),
  amountCents: AmountCentsSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(DONATION_STATUSES),
  privacyMode: z.enum(PRIVACY_MODES),
  dedication: z
    .strictObject({ type: z.enum(['in_honor_of', 'in_memory_of']), name: z.string() })
    .nullable(),
  message: z.string().nullable(),
  createdAt: isoDate,
  refundedAt: isoDate.nullable(),
});

export const DonationDetailListSchema = z.strictObject({ data: z.array(DonationDetailSchema) });

export const AdminDonationSchema = DonationDetailSchema.extend({
  donorEmail: z.string().min(1),
  failureCode: z.string().nullable(),
});

export const AdminDonationPageSchema = z.strictObject({
  data: z.array(AdminDonationSchema),
  page: z.int().positive(),
  pageSize: z.int().positive(),
  total: z.int().nonnegative(),
  // 0 when there is nothing to list.
  totalPages: z.int().nonnegative(),
});

// Digits are matched before they become numbers: z.coerce would read '1e1' as 10 and '' as 0.
// Express turns a repeated key into an array, which fails the string check.
const PageSchema = z.string().regex(/^\d{1,6}$/);
const PageSizeSchema = z.string().regex(/^\d{1,3}$/);

// A blank search means "no search": it is dropped here so the query never gets '%%'.
const SearchSchema = z
  .string()
  .transform(normaliseName)
  .superRefine(boundedText(0, MAX_SEARCH_CODE_POINTS))
  .refine((value) => !CONTROL.test(value), { message: 'invalid_characters' })
  .transform((value) => (value === '' ? undefined : value));

export const AdminDonationQuerySchema = z.strictObject({
  q: SearchSchema.optional(),
  status: z.enum(DONATION_STATUSES).optional(),
  sort: z.enum(ADMIN_SORTS).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: PageSchema.transform(Number).pipe(z.int().min(1)).default(1),
  pageSize: PageSizeSchema.transform(Number)
    .pipe(z.int().min(1).max(MAX_ADMIN_PAGE_SIZE))
    .default(DEFAULT_ADMIN_PAGE_SIZE),
});

export const RefundRequestSchema = z.strictObject({
  reason: z
    .string()
    .transform((value) => value.normalize('NFC').trim())
    .superRefine(boundedText(1, MAX_REFUND_REASON_CODE_POINTS))
    .refine((value) => !CONTROL_EXCEPT_LINE_BREAK.test(value), { message: 'invalid_characters' })
    // trim() keeps U+200B and U+2060, so a reason of only those would pass as non-blank.
    .refine((value) => normaliseName(value) !== '', { message: 'blank_reason' }),
});

export type DonationDetail = z.infer<typeof DonationDetailSchema>;
export type DonationDetailList = z.infer<typeof DonationDetailListSchema>;
export type AdminDonation = z.infer<typeof AdminDonationSchema>;
export type AdminDonationPage = z.infer<typeof AdminDonationPageSchema>;
export type AdminDonationQuery = z.infer<typeof AdminDonationQuerySchema>;
export type RefundRequest = z.infer<typeof RefundRequestSchema>;
