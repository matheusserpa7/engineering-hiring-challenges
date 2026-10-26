import { defineConfig } from 'vitest/config';

// Two projects so the unit tests run without Docker: `vitest run --project unit`. Only the
// integration project starts the shared Postgres container.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/db/**/*.test.ts'],
          globalSetup: ['test/global-setup.ts'],
          // The container is shared and each file truncates tables, which takes ACCESS
          // EXCLUSIVE locks. Parallel files would wipe each other's rows or deadlock.
          fileParallelism: false,
        },
      },
    ],
  },
});
