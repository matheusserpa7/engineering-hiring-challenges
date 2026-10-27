import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Three folders up from src/ and from dist/ alike, so the root is the same under tsx, under
// Vitest and the compiled dist/. Relative paths in this file are joined to it, never to the
// working directory, which is apps/api under `npm -w` and the repo root otherwise.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Intl is the authority on zone names, so a typo fails at boot instead of on the first receipt.
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// An origin is scheme, host and optional port, exactly as a browser sends it in `Origin`: no
// path, no trailing slash. Comparing the parsed form to the input rejects both, so the list can
// be matched with a plain string comparison.
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const OriginListSchema = z
  .string()
  .transform((list) => list.split(',').map((origin) => origin.trim()))
  .refine((origins) => origins.every(isOrigin));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // The seed is read in place and never copied or edited. An absolute value is used as is.
  SEED_DIR: z
    .string()
    .min(1)
    .default('roles/full-stack-engineer/seed')
    .transform((dir) => resolve(REPO_ROOT, dir)),
  // The one place the organisation's zone is read: it decides the year printed on a receipt.
  ORG_TIMEZONE: z.string().refine(isTimeZone).default('America/Chicago'),
  // One deadline for a charge and its retry. Past it the donor is told the outcome is unknown.
  PAYMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  // Simulated provider latency; tests and demos set it to 0.
  PAYMENT_MOCK_LATENCY_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  // Donation attempts per client address per 10 minutes, replays and malformed bodies included.
  DONATION_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(30),
  // The browser origins that may call the API with credentials (CORS) and that may send a
  // state-changing request at all. :3000 is nginx, :5173 is Vite in `npm run dev`.
  ALLOWED_ORIGINS: OriginListSchema.default([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]),
  // Fixed lifetime from login; activity does not extend it (tech spec 005 F8).
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(8),
  // An enum, not z.coerce.boolean(), which reads the string "false" as true. Turn it off only
  // for a browser that refuses Secure cookies on http://localhost.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // Login attempts per client address per 15 minutes, successes included.
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(20),
});

export type Config = z.infer<typeof EnvSchema>;

// Fails at boot and names the variables that are wrong. It never echoes a value, because
// DATABASE_URL carries the database password.
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const names = new Set(result.error.issues.map((issue) => issue.path.join('.')));
    throw new Error(`Invalid environment variables: ${[...names].join(', ')}. See .env.example.`);
  }
  return result.data;
}
