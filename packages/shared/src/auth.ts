import { z } from 'zod';
import { EmailSchema, boundedText } from './donations.js';

// The login contract (tech spec 005 §2). Strict, so a client cannot send a role: the role is
// read from the database on every request and never accepted.

export const MAX_PASSWORD_CODE_POINTS = 256;
export const USER_ROLES = ['donor', 'admin'] as const;

// The password is checked for length only. Normalising or trimming it here would make the
// hash differ from the one the seed stored; password.ts applies the one NFC step.
export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().superRefine(boundedText(1, MAX_PASSWORD_CODE_POINTS)),
});

export const SessionUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string().min(1),
  fullName: z.string().min(1),
  role: z.enum(USER_ROLES),
});

export const SessionResponseSchema = z.strictObject({ user: SessionUserSchema });

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type UserRole = (typeof USER_ROLES)[number];
