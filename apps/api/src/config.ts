import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
