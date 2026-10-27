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
