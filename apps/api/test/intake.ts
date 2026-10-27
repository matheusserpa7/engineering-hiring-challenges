import { createMockProvider } from '../src/payments/mock-provider.js';

// Settings for tests that build the app but never reach the donation route.
export const testIntake = {
  payments: createMockProvider({ latencyMs: 0 }),
  paymentTimeoutMs: 1000,
  orgTimezone: 'America/Chicago',
};
