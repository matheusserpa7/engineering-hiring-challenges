import { defineConfig, devices } from '@playwright/test';

// The suite drives the compose stack (`docker compose up --build`) through nginx and never
// resets it. Every spec reads and moves the same campaign total, so it runs serially, and a
// retry would hide a flake that is really a bug.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
