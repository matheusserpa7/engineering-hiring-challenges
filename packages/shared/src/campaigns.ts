import { z } from 'zod';
import { AmountCentsSchema } from './money.js';

// The public campaign contract (tech spec 003 §2 and §4). The API builds these shapes and the
// web app parses every response with them. Response schemas are strict on purpose: a payload
// that gains a field fails the web client, and the API's privacy test uses the same schema to
// assert that no extra key (an email, a donor id) can appear.

export const DEFAULT_RECENT_DONATIONS = 20;
export const MAX_RECENT_DONATIONS = 50;

export const CampaignSlugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

// The limit is checked as digits before it becomes a number. z.coerce would turn '' into 0
// and '1e1' into 10. Express parses a repeated key as an array, which fails the string check.
export const RecentDonationsQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_RECENT_DONATIONS))
    .optional(),
});

// UTC with a Z, as Date#toISOString and JSON.stringify(Date) produce. An offset such as
// +05:45 is rejected, so the API must serialise a Date and never a formatted string.
const isoDate = z.iso.datetime();

export const PublicDonationSchema = z.strictObject({
  id: z.uuid(),
  // The query always fills it ('Anonymous' at worst), so an empty one is a bug worth failing on.
  displayName: z.string().min(1),
  amountCents: AmountCentsSchema,
  dedication: z
    .strictObject({ type: z.enum(['in_honor_of', 'in_memory_of']), name: z.string() })
    .nullable(),
  message: z.string().nullable(),
  createdAt: isoDate,
});

// The 200 body of the list. It is an object with a key, not a bare array, so a field can be
// added later without breaking the shape.
export const PublicDonationListSchema = z.strictObject({ data: z.array(PublicDonationSchema) });

export const CAMPAIGN_PHASES = ['upcoming', 'open', 'closed'] as const;

// z.int() is a safe integer, which is what every cents field must be (ADR 0002).
export const PublicCampaignSchema = z.strictObject({
  id: z.uuid(),
  slug: CampaignSlugSchema,
  title: z.string().min(1),
  story: z.string().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  goalCents: z.int().positive(),
  raisedCents: z.int().nonnegative(),
  donorCount: z.int().nonnegative(),
  // Floored and not capped: a campaign past its goal honestly reads 115. The page caps the bar.
  progressPercent: z.int().nonnegative(),
  presetCents: z.array(AmountCentsSchema),
  minCents: AmountCentsSchema,
  maxCents: AmountCentsSchema,
  isActive: z.boolean(),
  phase: z.enum(CAMPAIGN_PHASES),
  startsAt: isoDate.nullable(),
  endsAt: isoDate.nullable(),
});

export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number];
export type PublicCampaign = z.infer<typeof PublicCampaignSchema>;
export type PublicDonation = z.infer<typeof PublicDonationSchema>;
export type PublicDonationList = z.infer<typeof PublicDonationListSchema>;
export type RecentDonationsQuery = z.infer<typeof RecentDonationsQuerySchema>;
