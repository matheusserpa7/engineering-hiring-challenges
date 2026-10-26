import { parseDollarsToCents } from '@aangan/shared';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

// Pure: file contents in, validated records out. Nothing here touches the disk or the
// database, so the seed rules can be tested without either.

export interface SeedCampaign {
  slug: string;
  title: string;
  story: string;
  goalCents: number;
  currency: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  presetCents: number[];
  minCents: number;
  maxCents: number;
}

export interface SeedDonation {
  receiptNumber: string;
  campaignSlug: string;
  donorName: string;
  donorEmail: string;
  amountCents: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  privacyMode: 'public' | 'anonymous' | 'family';
  dedicationType: 'in_honor_of' | 'in_memory_of' | null;
  dedicationName: string | null;
  message: string | null;
  isRecurring: boolean;
  createdAt: Date;
}

// A donation row holds a name, an email and a message. The message of this error names the
// receipt number and the failing field, and never a cell's content, because it ends up in logs.
export class SeedError extends Error {
  readonly receiptNumber: string | null;

  constructor(message: string, receiptNumber: string | null = null) {
    super(message);
    this.name = 'SeedError';
    this.receiptNumber = receiptNumber;
  }
}

// The only form a receipt number takes (HCC-{year}-{6 digits}). Checked before the value is
// ever put in an error message: a shifted CSV column could otherwise echo a name or an email.
const RECEIPT_NUMBER = /^HCC-\d{4}-\d{6}$/;

const nfc = (value: string): string => value.normalize('NFC');
const text = z.string().min(1).transform(nfc);
const isoDate = z.iso.datetime().transform((value) => new Date(value));
const blankToNull = <T extends string>(schema: z.ZodType<T>) =>
  z.union([z.literal(''), schema]).transform((value) => (value === '' ? null : value));

const CampaignSchema = z
  .strictObject({
    slug: text,
    title: text,
    story: text,
    goalCents: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    startsAt: isoDate.nullable(),
    endsAt: isoDate.nullable(),
    isActive: z.boolean(),
    presetAmountsCents: z.array(z.number().int().positive()),
    minimumCents: z.number().int().positive(),
    maximumCents: z.number().int().positive(),
  })
  .transform(({ presetAmountsCents, minimumCents, maximumCents, ...rest }): SeedCampaign => ({
    ...rest,
    presetCents: presetAmountsCents,
    minCents: minimumCents,
    maxCents: maximumCents,
  }));

const RowSchema = z.strictObject({
  receipt_number: z.string().regex(RECEIPT_NUMBER),
  campaign_slug: text,
  donor_name: text,
  donor_email: z.email().transform((value) => nfc(value).toLowerCase()),
  amount_dollars: z.string(),
  status: z.enum(['pending', 'completed', 'failed', 'refunded']),
  privacy_mode: z.enum(['public', 'anonymous', 'family']),
  dedication_type: blankToNull(z.enum(['in_honor_of', 'in_memory_of'])),
  dedication_name: blankToNull(text),
  dedication_message: blankToNull(text),
  is_recurring: z.enum(['true', 'false']).transform((value) => value === 'true'),
  created_at: isoDate,
});

// Field names only: a Zod message can carry the offending value, and the value may be PII.
function failingFields(error: z.ZodError): string {
  const paths = error.issues.map((issue) => issue.path.join('.') || '(row)');
  return [...new Set(paths)].join(', ');
}

function parseCampaigns(json: string): SeedCampaign[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new SeedError('campaigns.json is not valid JSON');
  }
  const result = z.array(CampaignSchema).safeParse(data);
  if (!result.success) {
    throw new SeedError(`campaigns.json is invalid: ${failingFields(result.error)}`);
  }
  // The database would silently skip a second campaign with the same slug.
  const slugs = result.data.map((campaign) => campaign.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new SeedError('campaigns.json is invalid: slug is duplicated');
  }
  return result.data;
}

function readRecords(csv: string): unknown[] {
  try {
    // trim stays off: whitespace inside a quoted name or message is data.
    return parse(csv, { columns: true, bom: true, skip_empty_lines: true, trim: false });
  } catch (error) {
    // csv-parse can quote the offending record in its message, so only its code is kept.
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    throw new SeedError(`donations.csv could not be parsed (${code})`);
  }
}

function parseDonation(
  record: unknown,
  position: number,
  campaigns: ReadonlySet<string>,
): SeedDonation {
  const receipt =
    typeof record === 'object' && record !== null && 'receipt_number' in record
      ? record.receipt_number
      : null;
  const receiptNumber =
    typeof receipt === 'string' && RECEIPT_NUMBER.test(receipt) ? receipt : null;

  const result = RowSchema.safeParse(record);
  if (!result.success) {
    throw new SeedError(
      `Seed row ${receiptNumber ?? `at position ${String(position)}`} is invalid: ${failingFields(result.error)}`,
      receiptNumber,
    );
  }
  const row = result.data;

  const amountCents = parseDollarsToCents(row.amount_dollars);
  if (amountCents === null) {
    throw new SeedError(
      `Seed row ${row.receipt_number} is invalid: amount_dollars`,
      row.receipt_number,
    );
  }
  if (!campaigns.has(row.campaign_slug)) {
    throw new SeedError(
      `Seed row ${row.receipt_number} is invalid: campaign_slug is not in campaigns.json`,
      row.receipt_number,
    );
  }

  return {
    receiptNumber: row.receipt_number,
    campaignSlug: row.campaign_slug,
    donorName: row.donor_name,
    donorEmail: row.donor_email,
    amountCents,
    status: row.status,
    privacyMode: row.privacy_mode,
    dedicationType: row.dedication_type,
    dedicationName: row.dedication_name,
    message: row.dedication_message,
    isRecurring: row.is_recurring,
    createdAt: row.created_at,
  };
}

export function parseSeed(files: { campaignsJson: string; donationsCsv: string }): {
  campaigns: SeedCampaign[];
  donations: SeedDonation[];
} {
  const campaigns = parseCampaigns(files.campaignsJson);
  const slugs = new Set(campaigns.map((campaign) => campaign.slug));

  const seen = new Set<string>();
  const records = readRecords(files.donationsCsv);
  // An empty file (a failed COPY into the image, say) must not read as a successful seed.
  if (records.length === 0) throw new SeedError('donations.csv has no rows');
  const donations = records.map((record, index) => {
    const donation = parseDonation(record, index + 1, slugs);
    // The database would silently skip the second row (ON CONFLICT DO NOTHING), so a
    // duplicate in the file has to fail here.
    if (seen.has(donation.receiptNumber)) {
      throw new SeedError(
        `Seed row ${donation.receiptNumber} is invalid: receipt_number is duplicated`,
        donation.receiptNumber,
      );
    }
    seen.add(donation.receiptNumber);
    return donation;
  });

  return { campaigns, donations };
}
