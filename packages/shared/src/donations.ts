import { z } from 'zod';
import { CampaignSlugSchema } from './campaigns.js';
import { AmountCentsSchema } from './money.js';

// The donation intake contract (tech spec 004 §2 and §7). The API parses the request with
// DonationRequestSchema and the web form builds exactly its keys, so a field one side adds
// and the other does not know fails loudly. Every object is strict: a client cannot send a
// status, a donor id, a role or a total, because no such key exists to be accepted.

export const MAX_NAME_CODE_POINTS = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_MESSAGE_CODE_POINTS = 280;

export const PRIVACY_MODES = ['public', 'anonymous', 'family'] as const;
export const DEDICATION_TYPES = ['in_honor_of', 'in_memory_of'] as const;
export const RECEIPT_STATUSES = ['completed', 'pending', 'refunded'] as const;

// A string's length counts UTF-16 units, so one emoji would be two. Counting code points is
// what the database's char_length does, which keeps the message check and its CHECK constraint
// equal. The web form's counter uses the same function.
export const codePointLength = (value: string): number => Array.from(value).length;

// Every \s (no-break space, U+202F, the BOM, tabs), the zero-width space and the word joiner
// (U+2060) become one space, so a name of only invisible characters ends up empty.
// ZWJ and ZWNJ stay: Devanagari conjuncts and Nepali names depend on them.
const SEPARATORS = /[\s\u200B\u2060]+/gu;

export function normaliseName(value: string): string {
  return value.normalize('NFC').replace(SEPARATORS, ' ').trim();
}

// Separators are already spaces when this runs, so what is left is a real control character.
export const CONTROL = /\p{Cc}/u;
// A message may hold line breaks; any other control character is rejected.
export const CONTROL_EXCEPT_LINE_BREAK = /(?![\n\r])\p{Cc}/u;

export function boundedText(min: number, max: number) {
  return (value: string, ctx: z.RefinementCtx): void => {
    const length = codePointLength(value);
    if (length < min) {
      ctx.addIssue({
        code: 'too_small',
        origin: 'string',
        minimum: min,
        inclusive: true,
        input: value,
      });
    } else if (length > max) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'string',
        maximum: max,
        inclusive: true,
        input: value,
      });
    }
  };
}

const NameSchema = z
  .string()
  .transform(normaliseName)
  .superRefine(boundedText(1, MAX_NAME_CODE_POINTS))
  .refine((value) => !CONTROL.test(value), { message: 'invalid_characters' });

export const EmailSchema = z
  .string()
  .transform((value) => value.normalize('NFC').trim().toLowerCase())
  .pipe(z.email().max(MAX_EMAIL_LENGTH));

// Blank means "no message", so it becomes null and the database never stores an empty string.
const MessageSchema = z
  .string()
  .transform((value) => value.normalize('NFC').trim())
  .superRefine(boundedText(0, MAX_MESSAGE_CODE_POINTS))
  .refine((value) => !CONTROL_EXCEPT_LINE_BREAK.test(value), { message: 'invalid_characters' })
  .transform((value) => (value === '' ? null : value));

export const DonationRequestSchema = z.strictObject({
  campaignSlug: CampaignSlugSchema,
  amountCents: AmountCentsSchema,
  donor: z.strictObject({ fullName: NameSchema, email: EmailSchema }),
  // The pair is required together: a type without a name (or the reverse) fails the object.
  dedication: z.strictObject({ type: z.enum(DEDICATION_TYPES), name: NameSchema }).nullish(),
  message: MessageSchema.nullish(),
  // Required, not defaulted: the form defaults it, the contract never picks a privacy level
  // for a caller that forgot (tech spec 004 E10).
  privacyMode: z.enum(PRIVACY_MODES),
  isRecurring: z.boolean().default(false),
  paymentToken: z.string().regex(/^tok_[a-z0-9_]{1,60}$/),
});

// Any hex UUID, not only RFC variants: the key is an opaque unguessable id, and the web app
// builds it from random bytes. Lower-cased so one key has one spelling in the unique index.
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase());

// What a donor gets back (2xx). Strict, like the public contract: a field that gains an
// email or a donor id fails the web client and the API's tests.
export const DonationReceiptSchema = z.strictObject({
  id: z.uuid(),
  // Six digits is a minimum, not a width: number 1,234,567 must not be cut.
  receiptNumber: z.string().regex(/^HCC-\d{4}-\d{6,}$/),
  amountCents: AmountCentsSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(RECEIPT_STATUSES),
  createdAt: z.iso.datetime(),
});

export type DonationRequest = z.infer<typeof DonationRequestSchema>;
export type DonationReceipt = z.infer<typeof DonationReceiptSchema>;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];
export type DedicationType = (typeof DEDICATION_TYPES)[number];
